import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import {
    AGENT_PROTOCOL_VERSION,
    AgentBridgeDescriptor,
    AgentOperation,
    AgentRequest,
    AgentResponse,
    bridgeRegistryDir,
} from './agentProtocol';

export class AgentClientError extends Error {
    constructor(readonly code: string, message: string, readonly details?: unknown) {
        super(message);
    }
}

export async function callAgentBridge(
    workspace: string,
    operation: AgentOperation,
    params?: unknown,
    sessionId?: string,
    responseTimeoutMs = 10_000,
): Promise<unknown> {
    const descriptors = findDescriptors(workspace).filter((entry) => !sessionId || entry.sessionId === sessionId);
    if (descriptors.length === 0) {
        throw new AgentClientError('EXTENSION_NOT_AVAILABLE', 'No active Maven Test Explorer Agent Bridge was found for this workspace.');
    }
    if (descriptors.length > 1) {
        throw new AgentClientError('MULTIPLE_SESSIONS', 'Multiple VS Code sessions match this workspace.', {
            sessions: descriptors.map((entry) => ({ sessionId: entry.sessionId, workspaceFolders: entry.workspaceFolders })),
        });
    }
    const descriptor = descriptors[0];
    const request: AgentRequest = {
        id: crypto.randomUUID(),
        token: descriptor.token,
        operation,
        params,
    };
    const response = await exchange(descriptor.endpoint, request, responseTimeoutMs);
    if (!response.ok) {
        throw new AgentClientError(
            response.error?.code ?? 'INTERNAL_ERROR',
            response.error?.message ?? 'Agent Bridge request failed.',
            response.error?.details,
        );
    }
    return response.result;
}

export function findDescriptors(workspace: string): AgentBridgeDescriptor[] {
    const requested = normalizePath(workspace);
    let entries: string[];
    try { entries = fs.readdirSync(bridgeRegistryDir()); } catch { return []; }
    const descriptors: AgentBridgeDescriptor[] = [];
    for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
            const descriptor = JSON.parse(fs.readFileSync(path.join(bridgeRegistryDir(), entry), 'utf8')) as AgentBridgeDescriptor;
            if (descriptor.protocolVersion !== AGENT_PROTOCOL_VERSION) continue;
            if (descriptor.workspaceFolders.some((folder) => isInside(normalizePath(folder), requested))) {
                descriptors.push(descriptor);
            }
        } catch {
            // Ignore incomplete or stale descriptor files.
        }
    }
    return descriptors.sort((left, right) => right.createdAt - left.createdAt);
}

function exchange(endpoint: string, request: AgentRequest, responseTimeoutMs: number): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(endpoint);
        let buffer = '';
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new AgentClientError('BRIDGE_TIMEOUT', `Agent Bridge did not respond within ${responseTimeoutMs} ms.`));
        }, responseTimeoutMs);
        socket.setEncoding('utf8');
        socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
        socket.on('data', (chunk: string) => {
            buffer += chunk;
            const newline = buffer.indexOf('\n');
            if (newline < 0) return;
            clearTimeout(timer);
            socket.end();
            try {
                resolve(JSON.parse(buffer.slice(0, newline)) as AgentResponse);
            } catch {
                reject(new AgentClientError('INVALID_RESPONSE', 'Agent Bridge returned invalid JSON.'));
            }
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            reject(new AgentClientError('EXTENSION_NOT_AVAILABLE', `Cannot connect to Agent Bridge: ${error.message}`));
        });
    });
}

function normalizePath(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
