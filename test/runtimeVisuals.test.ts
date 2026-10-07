import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunProgressLabels } from '../src/runtimeVisuals';

test('formats an indeterminate Maven run before a class total is known', () => {
    assert.deepEqual(buildRunProgressLabels(0, 0), {
        statusBarText: '$(sync~spin) Maven Tests',
        viewMessage: 'Running tests',
        tooltip: 'Maven tests are running. Click to open Maven Test Explorer.',
    });
});

test('formats completed and total class progress', () => {
    assert.deepEqual(buildRunProgressLabels(3, 10), {
        statusBarText: '$(sync~spin) Maven Tests 3/10',
        viewMessage: '3/10 classes',
        tooltip: 'Maven tests: 3 of 10 classes completed. Click to open Maven Test Explorer.',
    });
});

test('keeps malformed progress values within a valid range', () => {
    assert.equal(buildRunProgressLabels(12, 10).statusBarText, '$(sync~spin) Maven Tests 10/10');
    assert.equal(buildRunProgressLabels(-1, 10).viewMessage, '0/10 classes');
});
