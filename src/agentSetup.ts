export interface AgentSetupPacketOptions {
    readonly cliPath: string;
    readonly mcpPath: string;
    readonly workspace: string;
}

export function buildAgentSetupPacket(options: AgentSetupPacketOptions): string {
    const cliArgs = [options.cliPath];
    const mcpArgs = [options.mcpPath, '--workspace', options.workspace];
    const cliStatus = commandLine('node', [...cliArgs, 'status', '--workspace', options.workspace, '--json']);
    const cliConfig = commandLine('node', [...cliArgs, 'config', '--workspace', options.workspace, '--json']);
    const cliRun = commandLine('node', [
        ...cliArgs,
        'run',
        '--workspace', options.workspace,
        '--json',
    ]);
    const cliWait = commandLine('node', [
        ...cliArgs,
        'wait',
        '--workspace', options.workspace,
        '--run', '<run-id>',
        '--timeout', '300',
        '--json',
    ]);
    const codexConfig = [
        '[mcp_servers.maven_tests]',
        'command = "node"',
        `args = [${mcpArgs.map((value) => JSON.stringify(value)).join(', ')}]`,
    ].join('\n');
    const claudeConfig = JSON.stringify({
        mcpServers: {
            maven_tests: {
                type: 'stdio',
                command: 'node',
                args: mcpArgs,
            },
        },
    }, null, 2);

    return [
        'MAVEN TEST EXPLORER — AI AGENT SETUP PACKET',
        '',
        'Purpose: give this entire packet to a local coding agent so it can configure and use the Maven Test Explorer Agent Bridge.',
        'This packet is documentation and setup instructions; do not execute it as one shell script.',
        'The VS Code window containing this workspace and Maven Test Explorer must remain open while the bridge is used.',
        '',
        'SETUP TASK FOR THE AI AGENT',
        '',
        'Perform this setup now; do not merely explain these instructions back to the user.',
        '1. Detect which client you are running in. Preserve existing configuration and merge only the relevant MCP entry below.',
        '2. For Codex, create or update ~/.codex/config.toml (or the trusted project .codex/config.toml), merge the TOML entry, and verify it with `codex mcp list`.',
        '3. For Claude Code, create or update the project .mcp.json, merge the JSON entry, and verify it with `claude mcp get maven_tests` or `claude mcp list`.',
        '4. Add the policy block below to AGENTS.md for Codex or CLAUDE.md for Claude Code. Preserve all existing instructions and do not add a duplicate block.',
        '5. Verify the MCP registration. A new agent session may be required before the tools appear.',
        '6. If MCP cannot be loaded in the current session, use the CLI fallback commands below. Never run mvn directly when a managed run is required.',
        '',
        'CODEX MCP CONFIGURATION',
        '```toml',
        codexConfig,
        '```',
        '',
        'CLAUDE CODE MCP CONFIGURATION',
        '```json',
        claudeConfig,
        '```',
        '',
        'PROJECT INSTRUCTION BLOCK',
        '```markdown',
        '## Maven Test Explorer Agent Bridge',
        '',
        '- Use the `maven_tests_*` MCP tools for Maven test runs whenever Maven Test Explorer is available.',
        '- Always call `maven_tests_get_status` before starting a run. Never start a second run while one is active.',
        '- Use `maven_tests_get_configuration` to discover modules and effective defaults instead of guessing them.',
        '- Unless the user supplies overrides, use the goals, profiles, properties, and report-cleaning behavior returned by the extension.',
        '- Start managed runs with `maven_tests_start`; do not invoke `mvn`, `mvnw`, or `mvnw.cmd` directly when managed tracking is required.',
        '- Wait for completion with `maven_tests_wait` using the returned run ID; use `maven_tests_get_status` and `maven_tests_get_output` only for intermediate progress or diagnostics.',
        '- Read final failures from the wait result\'s `failures` (or status `lastRun.failures`) and the aggregate line from `surefireSummary`; do not scrape XML or grep Maven output for them.',
        '- Agent runs default to the safe agent-specific configuration returned by `maven_tests_get_configuration`: goals `test` and report cleanup disabled unless workspace settings override them.',
        '- Stop a run only when explicitly requested, using `maven_tests_stop` with the current run ID.',
        '- If the MCP tools are unavailable, use the Maven Test Explorer CLI fallback supplied by the extension and follow the same status-before-start rule.',
        '```',
        '',
        'UPDATE FOR EXISTING AGENT SETUPS',
        '',
        'If Maven Test Explorer Agent Bridge was configured earlier, update the existing AGENTS.md or CLAUDE.md block now:',
        '- add `maven_tests_wait` as the normal completion path instead of polling status in a loop;',
        '- consume the wait result\'s `failures` and `surefireSummary` (or the same fields under status `lastRun`) instead of reading Surefire XML or grepping output;',
        '- remove instructions that force `clean test` or report cleanup for agent runs; use the agent-specific defaults returned by configuration;',
        '- keep all unrelated project instructions unchanged and do not add a second Maven Test Explorer block.',
        '',
        'CLI FALLBACK — CHECK STATUS',
        '```powershell',
        cliStatus,
        '```',
        '',
        'CLI FALLBACK — READ CONFIGURATION',
        '```powershell',
        cliConfig,
        '```',
        '',
        'CLI FALLBACK — EXAMPLE MANAGED RUN',
        '```powershell',
        cliRun,
        '```',
        '',
        'CLI FALLBACK — WAIT FOR COMPLETION',
        '```powershell',
        cliWait,
        '```',
        '',
        'After setup, verify MCP with `maven_tests_get_status`. If using CLI, run the status command above.',
    ].join('\n');
}

function commandLine(executable: string, args: readonly string[]): string {
    return [executable, ...args.map(quoteCommandArgument)].join(' ');
}

function quoteCommandArgument(value: string): string {
    if (!/[\s"&|<>^]/.test(value)) return value;
    return `"${value.replace(/"/g, '\\"')}"`;
}
