import * as assert from 'node:assert/strict';
import test from 'node:test';
import { OUTPUT_BUFFER_LIMIT } from '../src/agentProtocol';
import { RunCoordinator } from '../src/runCoordinator';

test('tracks managed run lifecycle, progress, output, and final status', () => {
    const coordinator = new RunCoordinator();
    const started = coordinator.start('agent', 'Parallel', 2);
    coordinator.setExecution(['mvn', 'test', '-Pparallel'], 'C:/repo', 123);
    coordinator.classStarted('LoginTest');
    coordinator.appendOutput('first\nsecond\nthird\n');
    coordinator.setResults(
        { passed: 1, failed: 1, errors: 0, skipped: 0 },
        [{ test: 'example.LoginTest#fails', message: 'expected true' }],
    );

    const active = coordinator.getStatus();
    assert.equal(active.active, true);
    assert.equal(active.run?.runId, started.runId);
    assert.equal(active.run?.pid, 123);
    assert.deepEqual(active.run?.currentClasses, ['LoginTest']);
    assert.equal(active.run?.surefireSummary, 'Tests run: 2, Failures: 1, Errors: 0, Skipped: 0');
    assert.deepEqual(active.run?.failures, [{ test: 'example.LoginTest#fails', message: 'expected true' }]);
    assert.equal(coordinator.getOutput(started.runId, 2).output, 'second\nthird');

    coordinator.classCompleted('LoginTest');
    coordinator.finish('completed');
    const completed = coordinator.getStatus();
    assert.equal(completed.active, false);
    assert.equal(completed.lastRun?.status, 'completed');
    assert.equal(completed.lastRun?.completedClasses, 1);
});

test('waits for a run to finish and returns an already completed run immediately', async () => {
    const coordinator = new RunCoordinator();
    const started = coordinator.start('agent', 'Wait', 1);
    const waiting = coordinator.waitForRun(started.runId, 1_000);
    coordinator.finish('completed');
    assert.equal((await waiting).status, 'completed');
    assert.equal((await coordinator.waitForRun(started.runId, 1)).runId, started.runId);
});

test('times out without cancelling the active run and includes its snapshot', async () => {
    const coordinator = new RunCoordinator();
    const started = coordinator.start('agent', 'Slow', 1);
    await assert.rejects(
        coordinator.waitForRun(started.runId, 5),
        (error: { code?: string; details?: { run?: { runId?: string } } }) =>
            error.code === 'RUN_WAIT_TIMEOUT' && error.details?.run?.runId === started.runId,
    );
    assert.equal(coordinator.getStatus().active, true);
});

test('rejects waiting for an unknown run', async () => {
    const coordinator = new RunCoordinator();
    await assert.rejects(
        coordinator.waitForRun('missing', 10),
        (error: { code?: string }) => error.code === 'RUN_NOT_FOUND',
    );
});

test('rejects overlapping runs and stale stop identifiers', () => {
    const coordinator = new RunCoordinator();
    const started = coordinator.start('webview', 'Run all', 1);
    assert.throws(() => coordinator.start('agent', 'Duplicate', 1), (error: { code?: string }) => error.code === 'RUN_ALREADY_ACTIVE');
    assert.throws(() => coordinator.assertActiveRun('stale'), (error: { code?: string }) => error.code === 'RUN_ID_MISMATCH');
    assert.equal(coordinator.assertActiveRun(started.runId).runId, started.runId);
});

test('bounds captured output', () => {
    const coordinator = new RunCoordinator();
    const run = coordinator.start('agent', 'Large output', 0);
    coordinator.appendOutput('x'.repeat(OUTPUT_BUFFER_LIMIT + 4096));
    const output = coordinator.getOutput(run.runId, 1);
    assert.equal(output.truncated, true);
    assert.ok(output.output.length < OUTPUT_BUFFER_LIMIT);
});
