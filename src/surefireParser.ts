import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

export type TestCaseStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface TestCaseResult {
    readonly className: string;
    readonly methodName: string;
    readonly status: TestCaseStatus;
    readonly durationMs: number;
    readonly failureMessage: string | undefined;
    readonly failureType: string | undefined;
    readonly stackTrace: string | undefined;
    readonly systemOut: string | undefined;
    readonly systemErr: string | undefined;
    /** UI-only placeholder for a test Maven did not execute after a lifecycle failure. */
    readonly synthetic?: boolean;
}

export interface SuiteResult {
    readonly suiteName: string;
    readonly xmlPath: string;
    /** Surefire's full class/suite duration, including class-level fixtures. */
    readonly durationMs?: number;
    readonly testCases: readonly TestCaseResult[];
}

const XML_PARSER_OPTIONS = {
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    allowBooleanAttributes: true,
    trimValues: true,
    parseTagValue: true,
    isArray: (tagName: string): boolean =>
        tagName === 'testcase' || tagName === 'failure' || tagName === 'error',
} as const;

/**
 * Parses a single Surefire/Failsafe XML report file.
 * Returns undefined if the file cannot be read or is malformed.
 */
export function parseReportFile(xmlPath: string): SuiteResult | undefined {
    let content: string;
    try {
        content = fs.readFileSync(xmlPath, 'utf8');
    } catch {
        return undefined;
    }

    try {
        return parseXmlContent(content, xmlPath);
    } catch {
        return undefined;
    }
}

/**
 * Parses the raw XML content of a Surefire report.
 */
function parseXmlContent(content: string, xmlPath: string): SuiteResult | undefined {
    const parser = new XMLParser(XML_PARSER_OPTIONS);
    const root = parser.parse(content) as Record<string, unknown>;

    const suite = root['testsuite'] as Record<string, unknown> | undefined;
    if (!suite) {
        return undefined;
    }

    const suiteName = String(suite['@_name'] ?? '');
    const suiteTimeSeconds = Number(suite['@_time'] ?? Number.NaN);
    const durationMs = Number.isFinite(suiteTimeSeconds)
        ? Math.max(0, suiteTimeSeconds * 1000)
        : undefined;
    const rawTestCases = (suite['testcase'] as unknown[]) ?? [];
    const testCases: TestCaseResult[] = [];

    for (const rawCase of rawTestCases) {
        const tc = rawCase as Record<string, unknown>;
        const result = parseTestCase(tc);
        if (result) {
            testCases.push(result);
        }
    }

    return { suiteName, xmlPath, durationMs, testCases };
}

function parseTestCase(tc: Record<string, unknown>): TestCaseResult | undefined {
    // Surefire 3.x emits <testcase name=""> (empty name) when a lifecycle method
    // such as @BeforeAll throws before any individual test runs.  Rename it so
    // the publisher creates a visible '@BeforeAll' node instead of silently
    // falling back to the class item.
    const rawName = String(tc['@_name'] ?? '');
    const methodName = rawName === '' ? '@BeforeAll' : rawName;
    const className = String(tc['@_classname'] ?? '');
    const timeSeconds = Number(tc['@_time'] ?? 0);
    // Keep Surefire's sub-millisecond precision. Rounding thousands of fast
    // tests individually can inflate their aggregate duration by seconds.
    const durationMs = Math.max(0, timeSeconds * 1000);

    const systemOut = extractText(tc['system-out']);
    const systemErr = extractText(tc['system-err']);

    // Determine status
    if (tc['skipped'] !== undefined) {
        return {
            className,
            methodName,
            status: 'skipped',
            durationMs,
            failureMessage: undefined,
            failureType: undefined,
            stackTrace: undefined,
            systemOut,
            systemErr,
        };
    }

    const failures = tc['failure'] as Array<Record<string, unknown>> | undefined;
    if (failures && failures.length > 0) {
        const failure = failures[0];
        return {
            className,
            methodName,
            status: 'failed',
            durationMs,
            failureMessage: extractAttribute(failure, '@_message'),
            failureType: extractAttribute(failure, '@_type'),
            stackTrace: extractText(failure['#text'] ?? failure),
            systemOut,
            systemErr,
        };
    }

    const errors = tc['error'] as Array<Record<string, unknown>> | undefined;
    if (errors && errors.length > 0) {
        const error = errors[0];
        return {
            className,
            methodName,
            status: 'error',
            durationMs,
            failureMessage: extractAttribute(error, '@_message'),
            failureType: extractAttribute(error, '@_type'),
            stackTrace: extractText(error['#text'] ?? error),
            systemOut,
            systemErr,
        };
    }

    return {
        className,
        methodName,
        status: 'passed',
        durationMs,
        failureMessage: undefined,
        failureType: undefined,
        stackTrace: undefined,
        systemOut,
        systemErr,
    };
}

function extractAttribute(obj: Record<string, unknown>, key: string): string | undefined {
    const value = obj[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    const str = String(value).trim();
    return str.length > 0 ? str : undefined;
}

function extractText(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'object') {
        const text = (value as Record<string, unknown>)['#text'];
        if (text !== undefined && text !== null) {
            const str = String(text).trim();
            return str.length > 0 ? str : undefined;
        }
    }
    return undefined;
}
