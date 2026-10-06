import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import {
    AGENT_PROTOCOL_VERSION,
    AgentBridgeDescriptor,
    AgentRequest,
    AgentResponse,
    bridgeEndpoint,
    bridgeRegistryDir,
    descriptorPath,
    workspaceKey,
} from './agentProtocol';

export interface AgentBridgeHandlers {
    handle(request: AgentRequest): Promise<unknown>;
}

export class AgentBridgeServer {
    private server: net.Server | undefined;
    private descriptor: AgentBridgeDescriptor | undefined;
    private descriptorFile: string | undefined;

    constructor(
        private readonly workspaceFolders: readonly string[],
        private readonly handlers: AgentBridgeHandlers,
    ) {}

    async start(): Promise<AgentBridgeDescriptor> {
        if (this.descriptor) return this.descriptor;
        fs.mkdirSync(bridgeRegistryDir(), { recursive: true });
        const key = workspaceKey(this.workspaceFolders);
        const sessionId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        const endpoint = bridgeEndpoint(key, sessionId);
        if (process.platform !== 'win32') {
            try { fs.unlinkSync(endpoint); } catch { /* absent */ }
        }
        const token = crypto.randomBytes(32).toString('hex');
        const server = net.createServer((socket) => this.accept(socket, token));
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            server.once('error', onError);
            server.listen(endpoint, () => {
                server.off('error', onError);
                resolve();
            });
        });
        this.server = server;
        this.descriptor = {
            protocolVersion: AGENT_PROTOCOL_VERSION,
            sessionId,
            workspaceKey: key,
            workspaceFolders: [...this.workspaceFolders],
            endpoint,
            token,
            processId: process.pid,
            createdAt: Date.now(),
        };
        this.descriptorFile = descriptorPath(key, sessionId);
        const temporary = `${this.descriptorFile}.tmp-${process.pid}`;
        fs.writeFileSync(temporary, JSON.stringify(this.descriptor), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, this.descriptorFile);
        return this.descriptor;
    }

    async dispose(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        if (server) {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        if (this.descriptorFile) {
            try { fs.unlinkSync(this.descriptorFile); } catch { /* already removed */ }
        }
        if (this.descriptor?.endpoint && process.platform !== 'win32') {
            try { fs.unlinkSync(this.descriptor.endpoint); } catch { /* already removed */ }
        }
        this.descriptor = undefined;
        this.descriptorFile = undefined;
    }

    private accept(socket: net.Socket, token: string): void {
        socket.setEncoding('utf8');
        let buffer = '';
        socket.on('data', (chunk: string) => {
            buffer += chunk;
            if (Buffer.byteLength(buffer, 'utf8') > 1024 * 1024) {
                socket.destroy(new Error('Agent Bridge request exceeded 1 MiB.'));
                return;
            }
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (line.trim()) void this.respond(socket, line, token);
            }
        });
    }

    private async respond(socket: net.Socket, line: string, token: string): Promise<void> {
        let request: AgentRequest;
        try {
            request = JSON.parse(line) as AgentRequest;
        } catch {
            socket.write(`${JSON.stringify(errorResponse('', 'INVALID_JSON', 'Request is not valid JSON.'))}\n`);
            return;
        }
        if (request.token !== token) {
            socket.write(`${JSON.stringify(errorResponse(request.id, 'UNAUTHORIZED', 'Invalid Agent Bridge token.'))}\n`);
            return;
        }
        try {
            const result = await this.handlers.handle(request);
            const response: AgentResponse = { id: request.id, ok: true, result };
            socket.write(`${JSON.stringify(response)}\n`);
        } catch (error) {
            const candidate = error as { code?: string; message?: string; details?: unknown };
            socket.write(`${JSON.stringify(errorResponse(
                request.id,
                candidate.code ?? 'INTERNAL_ERROR',
                candidate.message ?? String(error),
                candidate.details,
            ))}\n`);
        }
    }
}

function errorResponse(id: string, code: string, message: string, details?: unknown): AgentResponse {
    return { id, ok: false, error: { code, message, details } };
}

export function removeStaleDescriptors(): void {
    let entries: string[];
    try { entries = fs.readdirSync(bridgeRegistryDir()); } catch { return; }
    for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const file = path.join(bridgeRegistryDir(), entry);
        let descriptor: AgentBridgeDescriptor | undefined;
        try {
            descriptor = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentBridgeDescriptor;
            process.kill(descriptor.processId, 0);
        } catch {
            try { fs.unlinkSync(file); } catch { /* ignored */ }
            if (descriptor?.endpoint && process.platform !== 'win32') {
                try { fs.unlinkSync(descriptor.endpoint); } catch { /* ignored */ }
            }
        }
    }
}
