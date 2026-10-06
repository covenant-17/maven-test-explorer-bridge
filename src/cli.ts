#!/usr/bin/env node
import { callAgentBridge, AgentClientError } from './agentBridgeClient';
import { AgentStartRunRequest } from './agentProtocol';

interface ParsedArguments {
    readonly command: string;
    readonly workspace: string;
    readonly session?: string;
    readonly json: boolean;
    readonly options: Map<string, string[]>;
}

void main();

async function main(): Promise<void> {
    try {
        const parsed = parseArguments(process.argv.slice(2));
        const result = await execute(parsed);
        process.stdout.write(`${JSON.stringify(result, null, parsed.json ? 0 : 2)}\n`);
    } catch (error) {
        const candidate = error as { code?: string; message?: string; details?: unknown };
        const code = candidate.code ?? 'INVALID_REQUEST';
        process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message: candidate.message ?? String(error), details: candidate.details } })}\n`);
        process.exitCode = exitCodeFor(code);
    }
}

async function execute(parsed: ParsedArguments): Promise<unknown> {
    switch (parsed.command) {
        case 'status':
            return callAgentBridge(parsed.workspace, 'get_status', undefined, parsed.session);
        case 'config':
            return callAgentBridge(parsed.workspace, 'get_configuration', undefined, parsed.session);
        case 'output':
            return callAgentBridge(parsed.workspace, 'get_output', {
                runId: first(parsed.options, 'run'),
                tailLines: numberOption(parsed.options, 'tail', 200),
            }, parsed.session);
        case 'stop': {
            const runId = required(parsed.options, 'run');
            return callAgentBridge(parsed.workspace, 'stop_run', { runId }, parsed.session);
        }
        case 'run':
            return callAgentBridge(parsed.workspace, 'start_run', buildStartRequest(parsed.options), parsed.session);
        default:
            throw new Error('Usage: mteb <status|config|run|output|stop> [--workspace path] [--json]');
    }
}

function buildStartRequest(options: Map<string, string[]>): AgentStartRunRequest {
    const selectors = options.get('test') ?? [];
    const properties: Record<string, string> = {};
    for (const property of options.get('property') ?? []) {
        const separator = property.indexOf('=');
        if (separator <= 0) throw new Error(`Invalid --property value: ${property}. Expected KEY=VALUE.`);
        properties[property.slice(0, separator)] = property.slice(separator + 1);
    }
    return {
        scope: selectors.length > 0
            ? { kind: 'tests', selectors, moduleKey: first(options, 'module') }
            : { kind: 'all' },
        goals: optionalValues(options, 'goal'),
        profiles: optionalValues(options, 'profile'),
        properties: Object.keys(properties).length > 0 ? properties : undefined,
        additionalArgs: optionalValues(options, 'arg'),
        cleanReports: booleanOption(options, 'clean-reports'),
        label: first(options, 'label'),
    };
}

function parseArguments(args: readonly string[]): ParsedArguments {
    const command = args[0] ?? '';
    const options = new Map<string, string[]>();
    for (let index = 1; index < args.length; index++) {
        const token = args[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const name = token.slice(2);
        if (name === 'json' || name === 'clean-reports' || name === 'no-clean-reports') {
            options.set(name, ['true']);
            continue;
        }
        const value = args[++index];
        if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${name}.`);
        options.set(name, [...(options.get(name) ?? []), value]);
    }
    return {
        command,
        workspace: first(options, 'workspace') ?? process.cwd(),
        session: first(options, 'session'),
        json: options.has('json'),
        options,
    };
}

function first(options: Map<string, string[]>, name: string): string | undefined {
    return options.get(name)?.[0];
}

function required(options: Map<string, string[]>, name: string): string {
    const value = first(options, name);
    if (!value) throw new Error(`--${name} is required.`);
    return value;
}

function optionalValues(options: Map<string, string[]>, name: string): string[] | undefined {
    const values = options.get(name);
    return values && values.length > 0 ? values : undefined;
}

function numberOption(options: Map<string, string[]>, name: string, fallback: number): number {
    const value = first(options, name);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
    return parsed;
}

function booleanOption(options: Map<string, string[]>, name: string): boolean | undefined {
    if (options.has(name)) return true;
    if (options.has(`no-${name}`)) return false;
    return undefined;
}

function exitCodeFor(code: string): number {
    if (code === 'EXTENSION_NOT_AVAILABLE' || code === 'BRIDGE_TIMEOUT') return 3;
    if (['RUN_ALREADY_ACTIVE', 'NO_ACTIVE_RUN', 'RUN_ID_MISMATCH', 'RUN_NOT_FOUND', 'MULTIPLE_SESSIONS'].includes(code)) return 4;
    if (code === 'INVALID_REQUEST' || code === 'INVALID_JSON') return 2;
    return 1;
}

export { buildStartRequest, parseArguments, exitCodeFor, AgentClientError };
