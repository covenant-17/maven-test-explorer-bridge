import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

export const AGENT_PROTOCOL_VERSION = 2;
export const OUTPUT_BUFFER_LIMIT = 1024 * 1024;

export type RunSource = 'webview' | 'testing-api' | 'agent';
export type ManagedRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunScopeAll {
    readonly kind: 'all';
}

export interface AgentRunScopeTests {
    readonly kind: 'tests';
    readonly selectors: readonly string[];
    readonly moduleKey?: string;
}

export type AgentRunScope = AgentRunScopeAll | AgentRunScopeTests;

export interface AgentStartRunRequest {
    readonly scope?: AgentRunScope;
    readonly goals?: readonly string[];
    readonly profiles?: readonly string[];
    readonly properties?: Readonly<Record<string, string | number | boolean>>;
    readonly additionalArgs?: readonly string[];
    readonly cleanReports?: boolean;
    readonly label?: string;
}

export interface AgentRunStats {
    readonly passed: number;
    readonly failed: number;
    readonly errors: number;
    readonly skipped: number;
}

export interface AgentRunFailure {
    readonly test: string;
    readonly message: string;
}

export interface ActiveRunSnapshot {
    readonly runId: string;
    readonly source: RunSource;
    readonly label: string;
    readonly status: ManagedRunStatus;
    readonly command?: readonly string[];
    readonly cwd?: string;
    readonly pid?: number;
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly currentClasses: readonly string[];
    readonly completedClasses: number;
    readonly totalClasses: number;
    readonly stats: AgentRunStats;
    readonly failures: readonly AgentRunFailure[];
    readonly surefireSummary: string;
}

export interface AgentConfigurationSnapshot {
    readonly workspaceFolders: readonly string[];
    readonly modules: readonly { key: string; artifactId: string; moduleDir: string }[];
    readonly defaults: {
        readonly goals: readonly string[];
        readonly profiles: readonly string[];
        readonly additionalArgs: string;
        readonly cleanReports: boolean;
    };
}

export interface AgentBridgeDescriptor {
    readonly protocolVersion: number;
    readonly sessionId: string;
    readonly workspaceKey: string;
    readonly workspaceFolders: readonly string[];
    readonly endpoint: string;
    readonly token: string;
    readonly processId: number;
    readonly createdAt: number;
}

export type AgentOperation = 'get_status' | 'get_configuration' | 'start_run' | 'get_output' | 'wait_for_run' | 'stop_run';

export interface AgentRequest {
    readonly id: string;
    readonly token: string;
    readonly operation: AgentOperation;
    readonly params?: unknown;
}

export interface AgentResponse {
    readonly id: string;
    readonly ok: boolean;
    readonly result?: unknown;
    readonly error?: { code: string; message: string; details?: unknown };
}

export function workspaceKey(workspaceFolders: readonly string[]): string {
    const normalized = workspaceFolders
        .map((folder) => path.resolve(folder).toLocaleLowerCase())
        .sort()
        .join('\n');
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

export function bridgeRegistryDir(): string {
    return path.join(os.tmpdir(), 'maven-test-explorer-bridge');
}

export function descriptorPath(key: string, sessionId: string): string {
    return path.join(bridgeRegistryDir(), `${key}-${sessionId}.json`);
}

export function bridgeEndpoint(key: string, sessionId: string): string {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\maven-test-explorer-${key}-${sessionId}`;
    }
    return path.join(bridgeRegistryDir(), `${key}-${sessionId}.sock`);
}

export function validateStartRunRequest(value: unknown): AgentStartRunRequest {
    if (!isRecord(value)) {
        throw new Error('Run request must be an object.');
    }
    const scope = validateScope(value.scope);
    const goals = optionalStringArray(value.goals, 'goals', false);
    if (goals && goals.length === 0) {
        throw new Error('goals must contain at least one Maven goal.');
    }
    const profiles = optionalStringArray(value.profiles, 'profiles', false);
    const additionalArgs = optionalStringArray(value.additionalArgs, 'additionalArgs', true);
    const cleanReports = value.cleanReports;
    if (cleanReports !== undefined && typeof cleanReports !== 'boolean') {
        throw new Error('cleanReports must be a boolean.');
    }
    const label = value.label;
    if (label !== undefined) {
        assertSafeString(label, 'label');
    }
    let properties: Record<string, string | number | boolean> | undefined;
    if (value.properties !== undefined) {
        if (!isRecord(value.properties)) {
            throw new Error('properties must be an object.');
        }
        properties = {};
        for (const [key, propertyValue] of Object.entries(value.properties)) {
            if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
                throw new Error(`Invalid Maven property name: ${key}`);
            }
            if (!['string', 'number', 'boolean'].includes(typeof propertyValue)) {
                throw new Error(`Invalid value for Maven property ${key}.`);
            }
            if (typeof propertyValue === 'string') {
                assertSafeString(propertyValue, `properties.${key}`, true);
            }
            properties[key] = propertyValue as string | number | boolean;
        }
    }
    return { scope, goals, profiles, properties, additionalArgs, cleanReports, label };
}

function validateScope(value: unknown): AgentRunScope | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value) || (value.kind !== 'all' && value.kind !== 'tests')) {
        throw new Error('scope.kind must be "all" or "tests".');
    }
    if (value.kind === 'all') {
        return { kind: 'all' };
    }
    const selectors = optionalStringArray(value.selectors, 'scope.selectors', false);
    if (!selectors || selectors.length === 0) {
        throw new Error('scope.selectors must contain at least one test selector.');
    }
    const moduleKey = value.moduleKey;
    if (moduleKey !== undefined) {
        assertSafeString(moduleKey, 'scope.moduleKey');
    }
    return { kind: 'tests', selectors, moduleKey };
}

function optionalStringArray(value: unknown, name: string, allowEmpty: boolean): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`${name} must be an array.`);
    }
    return value.map((entry, index) => {
        assertSafeString(entry, `${name}[${index}]`, allowEmpty);
        return entry;
    });
}

function assertSafeString(value: unknown, name: string, allowEmpty = false): asserts value is string {
    if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
        throw new Error(`${name} must be a non-empty string.`);
    }
    if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
        throw new Error(`${name} cannot contain NUL or newline characters.`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
