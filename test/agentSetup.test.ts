import * as assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentSetupPacket } from '../src/agentSetup';

test('builds a self-explanatory Codex and Claude setup packet', () => {
    const packet = buildAgentSetupPacket({
        cliPath: 'C:\\Users\\Example User\\mteb-cli.cjs',
        mcpPath: 'C:\\Users\\Example User\\mteb-mcp.cjs',
        workspace: 'C:\\!Dev\\sample project',
    });

    assert.match(packet, /^MAVEN TEST EXPLORER — AI AGENT SETUP PACKET/);
    assert.match(packet, /do not execute it as one shell script/);
    assert.match(packet, /Perform this setup now/);
    assert.match(packet, /\.codex\/config\.toml/);
    assert.match(packet, /\.mcp\.json/);
    assert.match(packet, /AGENTS\.md for Codex or CLAUDE\.md for Claude Code/);
    assert.match(packet, /\[mcp_servers\.maven_tests\]/);
    assert.match(packet, /"maven_tests"/);
    assert.match(packet, /maven_tests_get_status/);
    assert.match(packet, /maven_tests_set_profiles/);
    assert.match(packet, /mavenProfiles/);
    assert.match(packet, /node "C:\\Users\\Example User\\mteb-cli\.cjs" status/);
    assert.match(packet, /run --workspace "C:\\!Dev\\sample project" --json/);
    assert.match(packet, /profiles --workspace "C:\\!Dev\\sample project" --profile "<profile>" --json/);
    assert.doesNotMatch(packet, /run --workspace .* --clean-reports/);
    assert.match(packet, /maven_tests_wait/);
    assert.match(packet, /lastRun\.failures/);
    assert.match(packet, /status `lastRun`/);
    assert.match(packet, /`surefireSummary`/);
    assert.match(packet, /UPDATE FOR EXISTING AGENT SETUPS/);
    assert.match(packet, /mavenProfiles\.available/);
    assert.match(packet, /empty list to clear them/);
    assert.match(packet, /mavenTestExplorer\.profileDescription/);
    assert.match(packet, /repository · profile/);
    assert.match(packet, /wait --workspace "C:\\!Dev\\sample project" --run "<run-id>" --timeout 300 --json/);
});
