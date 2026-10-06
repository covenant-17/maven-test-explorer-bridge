import * as assert from 'node:assert/strict';
import test from 'node:test';
import { buildStartRequest, exitCodeFor, helpText, parseArguments } from '../src/cliCore';

test('general help documents every command and agent run option', () => {
    const help = helpText();
    for (const value of ['status', 'config', 'run', 'output', 'wait', 'stop']) assert.match(help, new RegExp(value));
    for (const flag of ['--test', '--module', '--goal', '--profile', '--property', '--arg', '--clean-reports', '--no-clean-reports']) {
        assert.match(help, new RegExp(flag));
    }
});

test('command help documents wait inputs', () => {
    assert.match(helpText('wait'), /wait --run <id> --timeout <seconds>/);
});

test('parses repeatable run options and report preservation', () => {
    const parsed = parseArguments(['run', '--test', 'OneTest', '--test', 'TwoTest#works', '--property', 'HEADLESS=true', '--no-clean-reports']);
    assert.deepEqual(buildStartRequest(parsed.options), {
        scope: { kind: 'tests', selectors: ['OneTest', 'TwoTest#works'], moduleKey: undefined },
        goals: undefined,
        profiles: undefined,
        properties: { HEADLESS: 'true' },
        additionalArgs: undefined,
        cleanReports: false,
        label: undefined,
    });
});

test('validates wait arguments and conflicting cleanup flags', () => {
    assert.throws(() => parseArguments(['wait', '--run', 'abc']), /--timeout is required/);
    assert.throws(() => parseArguments(['wait', '--run', 'abc', '--timeout', '0']), /positive integer/);
    const conflicting = parseArguments(['run', '--clean-reports', '--no-clean-reports']);
    assert.throws(() => buildStartRequest(conflicting.options), /cannot be used together/);
    assert.equal(exitCodeFor('RUN_WAIT_TIMEOUT'), 5);
});
