import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { AgentBridgeServer } from '../src/agentBridgeServer';
import { callAgentBridge } from '../src/agentBridgeClient';

test('round-trips authenticated requests through the local bridge', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mteb-workspace-'));
    const server = new AgentBridgeServer([workspace], {
        handle: async (request) => ({ operation: request.operation, params: request.params }),
    });
    try {
        const descriptor = await server.start();
        const result = await callAgentBridge(workspace, 'get_output', { tailLines: 10 }, descriptor.sessionId);
        assert.deepEqual(result, { operation: 'get_output', params: { tailLines: 10 } });
    } finally {
        await server.dispose();
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});
