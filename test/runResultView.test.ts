import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRunResultView } from '../src/runResultView';
import type { SuiteResult } from '../src/surefireParser';

const suite = (suiteName: string): SuiteResult => ({
    suiteName,
    xmlPath: `/reports/TEST-${suiteName}.xml`,
    testCases: [],
});

test('current run view keeps the latest runtime overlay', () => {
    const cached = [suite('Cached')];
    const runtime = [suite('CompletedDuringRun')];
    const runningNodeIds = new Set(['method:still-running']);

    const view = resolveRunResultView(cached, runtime, runningNodeIds);

    assert.equal(view.baseResults, cached);
    assert.equal(view.runtimeResults, runtime);
    assert.equal(view.runningNodeIds, runningNodeIds);
});

test('historical view is isolated from current run results and loaders', () => {
    const cached = [suite('Cached')];
    const runtime = [suite('CompletedDuringRun')];
    const historical = [suite('Historical')];

    const view = resolveRunResultView(cached, runtime, new Set(['method:still-running']), historical);

    assert.equal(view.baseResults, historical);
    assert.deepEqual(view.runtimeResults, []);
    assert.deepEqual(view.runningNodeIds, new Set());
});
