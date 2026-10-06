import { AgentClientError, callAgentBridge } from './agentBridgeClient';
import { AgentStartRunRequest } from './agentProtocol';

export interface ParsedArguments {
    readonly command: string;
    readonly workspace: string;
    readonly session?: string;
    readonly json: boolean;
    readonly options: Map<string, string[]>;
}

const COMMANDS = ['status', 'config', 'run', 'output', 'wait', 'stop'] as const;
const COMMON_OPTIONS = new Set(['workspace', 'session', 'json']);
const COMMAND_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
    status: new Set(),
    config: new Set(),
    run: new Set(['test', 'module', 'goal', 'profile', 'property', 'arg', 'clean-reports', 'no-clean-reports', 'label']),
    output: new Set(['run', 'tail']),
    wait: new Set(['run', 'timeout']),
    stop: new Set(['run']),
};

export async function runCli(args: readonly string[]): Promise<void> {
    const helpTopic = requestedHelpTopic(args);
    if (helpTopic !== null) {
        process.stdout.write(helpText(helpTopic || undefined));
        return;
    }
    try {
        const parsed = parseArguments(args);
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
        case 'wait': {
            const timeoutSeconds = numberOption(parsed.options, 'timeout');
            return callAgentBridge(parsed.workspace, 'wait_for_run', {
                runId: required(parsed.options, 'run'),
                timeoutSeconds,
            }, parsed.session, timeoutSeconds * 1000 + 2_000);
        }
        case 'stop':
            return callAgentBridge(parsed.workspace, 'stop_run', {
                runId: required(parsed.options, 'run'),
            }, parsed.session);
        case 'run':
            return callAgentBridge(parsed.workspace, 'start_run', buildStartRequest(parsed.options), parsed.session);
        default:
            throw new Error(`Unknown command: ${parsed.command}`);
    }
}

export function buildStartRequest(options: Map<string, string[]>): AgentStartRunRequest {
    if (options.has('clean-reports') && options.has('no-clean-reports')) {
        throw new Error('--clean-reports and --no-clean-reports cannot be used together.');
    }
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

export function parseArguments(args: readonly string[]): ParsedArguments {
    const command = args[0] ?? '';
    if (!COMMANDS.includes(command as typeof COMMANDS[number])) {
        throw new Error(`Unknown command: ${command || '(none)'}. Use mteb --help.`);
    }
    const options = new Map<string, string[]>();
    for (let index = 1; index < args.length; index++) {
        const token = args[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const name = token.slice(2);
        if (!COMMON_OPTIONS.has(name) && !COMMAND_OPTIONS[command].has(name)) {
            throw new Error(`Unknown option for ${command}: --${name}`);
        }
        if (name === 'json' || name === 'clean-reports' || name === 'no-clean-reports') {
            options.set(name, ['true']);
            continue;
        }
        const value = args[++index];
        if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${name}.`);
        options.set(name, [...(options.get(name) ?? []), value]);
    }
    if (command === 'wait') {
        required(options, 'run');
        numberOption(options, 'timeout');
    } else if (command === 'stop') {
        required(options, 'run');
    } else if (command === 'output' && options.has('tail')) {
        numberOption(options, 'tail');
    }
    return {
        command,
        workspace: first(options, 'workspace') ?? process.cwd(),
        session: first(options, 'session'),
        json: options.has('json'),
        options,
    };
}

export function helpText(command?: string): string {
    const common = [
        'Global options:',
        '  --workspace <path>  Workspace containing the active extension (default: current directory)',
        '  --session <id>      Select a VS Code session when more than one matches',
        '  --json              Print compact JSON for operational commands',
        '  --help              Show help',
    ].join('\n');
    const sections: Record<string, string> = {
        status: 'Usage: mteb status [global options]\n  Show the active managed run and the most recently completed run.',
        config: 'Usage: mteb config [global options]\n  Show Maven modules and effective safe Agent Bridge defaults.',
        run: [
            'Usage: mteb run [options] [global options]',
            '  --test <selector>       Run a test class or method; repeatable',
            '  --module <key>          Resolve test selectors within one Maven module',
            '  --goal <goal>           Override goals for an all-scope run; repeatable',
            '  --profile <profile>     Enable a Maven profile; repeatable',
            '  --property <KEY=VALUE>  Add a Maven property; repeatable',
            '  --arg <argument>        Add a raw Maven argument; repeatable',
            '  --clean-reports         Delete matching XML reports before the run',
            '  --no-clean-reports      Preserve existing XML reports before the run',
            '  --label <text>          Set the run label',
        ].join('\n'),
        output: [
            'Usage: mteb output [options] [global options]',
            '  --run <id>       Read a specific run (defaults to active or latest)',
            '  --tail <lines>   Return the last N lines (default: 200)',
        ].join('\n'),
        wait: [
            'Usage: mteb wait --run <id> --timeout <seconds> [global options]',
            '  --run <id>            Run identifier returned by run/status',
            '  --timeout <seconds>   Positive number of seconds to wait; does not cancel the run',
        ].join('\n'),
        stop: [
            'Usage: mteb stop --run <id> [global options]',
            '  --run <id>  Active run identifier returned by run/status',
            '  Cancel the active managed run and its Maven/JVM process tree.',
        ].join('\n'),
    };
    if (command && sections[command]) return `${sections[command]}\n\n${common}\n`;
    return [
        'Maven Test Explorer Agent Bridge CLI',
        '',
        'Usage: mteb <command> [options]',
        '',
        'Commands:',
        '  status   Show managed-run status',
        '  config   Show modules and effective Agent Bridge defaults',
        '  run      Start a managed Maven test run',
        '  output   Read captured Maven output',
        '  wait     Wait for a managed run to finish',
        '  stop     Cancel the active managed run',
        '',
        common,
        '',
        'Run `mteb <command> --help` for command-specific options.',
        '',
        sections.run.replace(/^Usage:[^\n]*\n/, ''),
        '',
        sections.output.replace(/^Usage:[^\n]*\n/, ''),
        '',
        sections.wait.replace(/^Usage:[^\n]*\n/, ''),
        '',
        sections.stop.replace(/^Usage:[^\n]*\n/, ''),
        '',
    ].join('\n');
}

function requestedHelpTopic(args: readonly string[]): string | undefined | null {
    if (args.length === 0 || args[0] === '--help' || args[0] === 'help') return args[1];
    if (args[1] === '--help') return args[0];
    return null;
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

function numberOption(options: Map<string, string[]>, name: string, fallback?: number): number {
    const value = first(options, name);
    if (value === undefined) {
        if (fallback !== undefined) return fallback;
        throw new Error(`--${name} is required.`);
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
    return parsed;
}

function booleanOption(options: Map<string, string[]>, name: string): boolean | undefined {
    if (options.has(name)) return true;
    if (options.has(`no-${name}`)) return false;
    return undefined;
}

export function exitCodeFor(code: string): number {
    if (code === 'EXTENSION_NOT_AVAILABLE' || code === 'BRIDGE_TIMEOUT') return 3;
    if (['RUN_ALREADY_ACTIVE', 'NO_ACTIVE_RUN', 'RUN_ID_MISMATCH', 'RUN_NOT_FOUND', 'MULTIPLE_SESSIONS'].includes(code)) return 4;
    if (code === 'RUN_WAIT_TIMEOUT') return 5;
    if (code === 'INVALID_REQUEST' || code === 'INVALID_JSON') return 2;
    return 1;
}

export { AgentClientError };
