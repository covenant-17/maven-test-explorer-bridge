import { MethodInfo, TestClassInfo, buildFqcn } from './javaTestScanner';
import { SuiteResult, TestCaseResult } from './surefireParser';

export type TestFilterExpression =
    | { kind: 'term'; value: string }
    | { kind: 'and'; left: TestFilterExpression; right: TestFilterExpression }
    | { kind: 'or'; left: TestFilterExpression; right: TestFilterExpression };

export interface FilteredClassInfo extends TestClassInfo {
    readonly methods: readonly MethodInfo[];
}

type TokenKind = 'term' | 'and' | 'or' | 'lparen' | 'rparen';

interface Token {
    readonly kind: TokenKind;
    readonly value: string;
}

interface TestFacts {
    readonly text: readonly string[];
    readonly tags: ReadonlySet<string>;
    readonly statuses: ReadonlySet<string>;
}

export function parseFilterExpression(input: string): TestFilterExpression | undefined {
    const tokens = tokenize(input);
    if (tokens.length === 0) {
        return undefined;
    }
    const parser = new Parser(tokens);
    const expression = parser.parseExpression();
    if (!expression || !parser.isAtEnd()) {
        throw new Error('Invalid filter expression');
    }
    return expression;
}

export function filterClassesByExpression(
    classes: readonly TestClassInfo[],
    expression: TestFilterExpression,
    suiteResults: readonly SuiteResult[],
): FilteredClassInfo[] {
    const statusByTest = buildStatusIndex(suiteResults);
    const filtered: FilteredClassInfo[] = [];

    for (const cls of classes) {
        const fqcn = buildFqcn(cls.packageName, cls.className);
        const classStatuses = collectClassStatuses(fqcn, statusByTest);
        const classFacts = buildClassFacts(cls, fqcn, classStatuses);
        const matchingMethods = cls.methods.filter((method) => {
            const methodStatuses = statusByTest.get(`${fqcn}#${method.name}`) ?? new Set<string>();
            return matchesExpression(expression, buildMethodFacts(cls, method, fqcn, methodStatuses));
        });

        if (matchesExpression(expression, classFacts) || matchingMethods.length > 0) {
            filtered.push({ ...cls, methods: matchingMethods.length > 0 ? matchingMethods : cls.methods });
        }
    }

    return filtered;
}

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (ch === '(') {
            tokens.push({ kind: 'lparen', value: ch });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ kind: 'rparen', value: ch });
            i++;
            continue;
        }
        if (ch === ',') {
            tokens.push({ kind: 'and', value: ch });
            i++;
            continue;
        }
        if (input.startsWith('&&', i)) {
            tokens.push({ kind: 'and', value: '&&' });
            i += 2;
            continue;
        }
        if (input.startsWith('||', i)) {
            tokens.push({ kind: 'or', value: '||' });
            i += 2;
            continue;
        }

        let end = i;
        let inQuotes = false;
        while (
            end < input.length
            && (inQuotes || (
                !/\s/.test(input[end])
                && input[end] !== '('
                && input[end] !== ')'
                && input[end] !== ','
            ))
        ) {
            if (input[end] === '"' && input[end - 1] !== '\\') {
                inQuotes = !inQuotes;
            }
            end++;
        }
        const value = input.substring(i, end);
        const upper = value.toUpperCase();
        if (upper === 'AND') {
            tokens.push({ kind: 'and', value });
        } else if (upper === 'OR') {
            tokens.push({ kind: 'or', value });
        } else {
            tokens.push({ kind: 'term', value });
        }
        i = end;
    }
    return tokens;
}

class Parser {
    private index = 0;

    constructor(private readonly tokens: readonly Token[]) {}

    isAtEnd(): boolean {
        return this.index >= this.tokens.length;
    }

    parseExpression(): TestFilterExpression | undefined {
        return this.parseOr();
    }

    private parseOr(): TestFilterExpression | undefined {
        let expr = this.parseAnd();
        while (expr && this.match('or')) {
            const right = this.parseAnd();
            if (!right) { throw new Error('Missing right side of OR'); }
            expr = { kind: 'or', left: expr, right };
        }
        return expr;
    }

    private parseAnd(): TestFilterExpression | undefined {
        let expr = this.parsePrimary();
        while (expr && this.match('and')) {
            const right = this.parsePrimary();
            if (!right) { throw new Error('Missing right side of AND'); }
            expr = { kind: 'and', left: expr, right };
        }
        return expr;
    }

    private parsePrimary(): TestFilterExpression | undefined {
        if (this.match('term')) {
            return { kind: 'term', value: this.previous().value };
        }
        if (this.match('lparen')) {
            const expr = this.parseExpression();
            if (!expr || !this.match('rparen')) {
                throw new Error('Unclosed group');
            }
            return expr;
        }
        return undefined;
    }

    private match(kind: TokenKind): boolean {
        if (this.peek()?.kind !== kind) {
            return false;
        }
        this.index++;
        return true;
    }

    private peek(): Token | undefined {
        return this.tokens[this.index];
    }

    private previous(): Token {
        return this.tokens[this.index - 1];
    }
}

function matchesExpression(expression: TestFilterExpression, facts: TestFacts): boolean {
    switch (expression.kind) {
        case 'term':
            return matchesTerm(expression.value, facts);
        case 'and':
            return matchesExpression(expression.left, facts) && matchesExpression(expression.right, facts);
        case 'or':
            return matchesExpression(expression.left, facts) || matchesExpression(expression.right, facts);
    }
}

function matchesTerm(rawTerm: string, facts: TestFacts): boolean {
    const term = rawTerm.trim();
    if (term.length === 0) {
        return true;
    }
    if (term.startsWith('@')) {
        const tag = normalize(term.substring(1));
        return facts.tags.has(tag) || facts.statuses.has(tag);
    }
    const needle = normalize(term);
    return facts.text.some((value) => normalize(value).includes(needle));
}

function buildStatusIndex(suiteResults: readonly SuiteResult[]): Map<string, Set<string>> {
    const statusByTest = new Map<string, Set<string>>();
    for (const suite of suiteResults) {
        for (const tc of suite.testCases) {
            const statuses = statusAliases(tc);
            statusByTest.set(`${tc.className}#${tc.methodName}`, statuses);
        }
    }
    return statusByTest;
}

function collectClassStatuses(fqcn: string, statusByTest: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
    const statuses = new Set<string>();
    const prefix = `${fqcn}#`;
    for (const [key, value] of statusByTest) {
        if (!key.startsWith(prefix)) {
            continue;
        }
        for (const status of value) {
            statuses.add(status);
        }
    }
    return statuses;
}

function buildClassFacts(cls: TestClassInfo, fqcn: string, statuses: ReadonlySet<string>): TestFacts {
    return {
        text: [cls.className, cls.displayName ?? '', fqcn, cls.packageName],
        tags: new Set(cls.tags.map(normalize)),
        statuses,
    };
}

function buildMethodFacts(
    cls: TestClassInfo,
    method: MethodInfo,
    fqcn: string,
    statuses: ReadonlySet<string>,
): TestFacts {
    return {
        text: [
            method.name,
            method.displayName ?? '',
            cls.className,
            cls.displayName ?? '',
            fqcn,
            `${fqcn}#${method.name}`,
            cls.packageName,
        ],
        tags: new Set([...cls.tags, ...method.tags].map(normalize)),
        statuses,
    };
}

function statusAliases(tc: TestCaseResult): Set<string> {
    const aliases = new Set<string>([statusTagId(tc.status), tc.status, 'executed']);
    if (tc.status === 'error') {
        aliases.add(statusTagId('failed'));
        aliases.add('failed');
    }
    return aliases;
}

function statusTagId(status: string): string {
    return `status.${status}`;
}

function normalize(value: string): string {
    return value.toLocaleLowerCase();
}
