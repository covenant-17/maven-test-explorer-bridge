#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AgentClientError, callAgentBridge } from './agentBridgeClient';
import { AGENT_PROTOCOL_VERSION } from './agentProtocol';

const workspace = argumentValue('--workspace') ?? process.cwd();
const session = argumentValue('--session');

const server = new McpServer(
    { name: 'maven-test-explorer-bridge', version: `${AGENT_PROTOCOL_VERSION}.0.0` },
    { instructions: 'Call maven_tests_get_status before starting tests. Do not start a second run while one is active.' },
);

server.registerTool('maven_tests_get_status', {
    title: 'Get Maven test run status',
    description: 'Check whether Maven Test Explorer has an active managed test run and inspect its progress.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async () => toolCall('get_status'));

server.registerTool('maven_tests_get_configuration', {
    title: 'Get Maven test configuration',
    description: 'Read resolved Maven modules and the effective default test-run settings for this workspace.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async () => toolCall('get_configuration'));

server.registerTool('maven_tests_start', {
    title: 'Start Maven tests',
    description: 'Start a managed Maven test run in the active Maven Test Explorer extension. Check status first.',
    inputSchema: {
        scopeKind: z.enum(['all', 'tests']).default('all'),
        selectors: z.array(z.string()).optional(),
        moduleKey: z.string().optional(),
        goals: z.array(z.string()).optional(),
        profiles: z.array(z.string()).optional(),
        properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        additionalArgs: z.array(z.string()).optional(),
        cleanReports: z.boolean().optional(),
        label: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (input) => toolCall('start_run', {
    scope: input.scopeKind === 'tests'
        ? { kind: 'tests', selectors: input.selectors ?? [], moduleKey: input.moduleKey }
        : { kind: 'all' },
    goals: input.goals,
    profiles: input.profiles,
    properties: input.properties,
    additionalArgs: input.additionalArgs,
    cleanReports: input.cleanReports,
    label: input.label,
}));

server.registerTool('maven_tests_get_output', {
    title: 'Read Maven test output',
    description: 'Read the recent output captured for an active or most recently completed managed run.',
    inputSchema: {
        runId: z.string().optional(),
        tailLines: z.number().int().min(1).max(1000).default(200),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async (input) => toolCall('get_output', input));

server.registerTool('maven_tests_wait', {
    title: 'Wait for Maven tests',
    description: 'Wait for a managed Maven test run to finish. A timeout reports the current snapshot and does not cancel Maven.',
    inputSchema: {
        runId: z.string().min(1),
        timeoutSeconds: z.number().int().min(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async (input) => toolCall(
    'wait_for_run',
    input,
    input.timeoutSeconds * 1000 + 2_000,
));

server.registerTool('maven_tests_stop', {
    title: 'Stop Maven tests',
    description: 'Cancel the active Maven test run and terminate its Maven/JVM process tree.',
    inputSchema: { runId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async (input) => toolCall('stop_run', input));

void server.connect(new StdioServerTransport()).catch((error: unknown) => {
    process.stderr.write(`Maven Test Explorer MCP failed: ${String(error)}\n`);
    process.exitCode = 1;
});

async function toolCall(
    operation: Parameters<typeof callAgentBridge>[1],
    params?: unknown,
    responseTimeoutMs?: number,
) {
    try {
        const result = await callAgentBridge(workspace, operation, params, session, responseTimeoutMs);
        return {
            structuredContent: asRecord(result),
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
    } catch (error) {
        const candidate = error as AgentClientError;
        return {
            isError: true,
            content: [{
                type: 'text' as const,
                text: JSON.stringify({ code: candidate.code ?? 'INTERNAL_ERROR', message: candidate.message, details: candidate.details }),
            }],
        };
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : { value };
}

function argumentValue(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}
