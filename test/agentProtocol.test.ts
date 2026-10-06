import * as assert from 'node:assert/strict';
import test from 'node:test';
import { validateStartRunRequest, workspaceKey } from '../src/agentProtocol';

test('validates a structured parallel Maven request', () => {
    assert.deepEqual(validateStartRunRequest({
        scope: { kind: 'tests', selectors: ['LoginTest', 'ProfileTest#opens'], moduleKey: 'module-a' },
        goals: ['test'],
        profiles: ['parallel'],
        properties: { HEADLESS: true, retries: 2 },
        additionalArgs: ['-DforkCount=4'],
        cleanReports: true,
        label: 'Agent run',
    }), {
        scope: { kind: 'tests', selectors: ['LoginTest', 'ProfileTest#opens'], moduleKey: 'module-a' },
        goals: ['test'],
        profiles: ['parallel'],
        properties: { HEADLESS: true, retries: 2 },
        additionalArgs: ['-DforkCount=4'],
        cleanReports: true,
        label: 'Agent run',
    });
});

test('rejects newlines and invalid Maven property names', () => {
    assert.throws(() => validateStartRunRequest({ goals: ['test\nwhoami'] }), /newline/);
    assert.throws(() => validateStartRunRequest({ properties: { 'bad key': 'value' } }), /property name/);
});

test('workspace key is stable regardless of folder order', () => {
    assert.equal(workspaceKey(['C:/repo/a', 'C:/repo/b']), workspaceKey(['C:/repo/b', 'C:/repo/a']));
});
