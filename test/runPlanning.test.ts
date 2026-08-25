import assert from 'node:assert/strict';
import test from 'node:test';
import {
    determineRunOutcome,
    ensureNonRecursiveArgs,
    MavenExecutionRecord,
    reportsStillMatchLastRun,
    shouldPersistRun,
} from '../src/runPlanning';

const execution = (exitCode: number): MavenExecutionRecord => ({
    moduleKey: 'module',
    moduleDir: '/module',
    exitCode,
});

test('adds non-recursive mode only to scoped Maven commands', () => {
    assert.deepEqual(ensureNonRecursiveArgs(['mvn', 'clean', 'test'], true), ['mvn', '-N', 'clean', 'test']);
    assert.deepEqual(ensureNonRecursiveArgs(['mvn', '-N', 'test'], true), ['mvn', '-N', 'test']);
    assert.deepEqual(ensureNonRecursiveArgs(['mvn', '--non-recursive', 'test'], true), ['mvn', '--non-recursive', 'test']);
    assert.deepEqual(ensureNonRecursiveArgs(['mvn', 'test'], false), ['mvn', 'test']);
});

test('uses cancelled > failed > completed outcome precedence', () => {
    assert.equal(determineRunOutcome(false, [execution(0)]), 'completed');
    assert.equal(determineRunOutcome(false, [execution(1), execution(0)]), 'failed');
    assert.equal(determineRunOutcome(true, [execution(1)]), 'cancelled');
    assert.equal(determineRunOutcome(false, []), 'completed');
});

test('history keeps failed and cancelled runs even without XML results', () => {
    assert.equal(shouldPersistRun('completed', 0), false);
    assert.equal(shouldPersistRun('completed', 1), true);
    assert.equal(shouldPersistRun('failed', 0), true);
    assert.equal(shouldPersistRun('cancelled', 0), true);
});

test('delayed watcher events preserve the outcome only for unchanged run reports', () => {
    const previous = [{ suiteName: 'Example', xmlPath: '/module/target/TEST-Example.xml', testCases: [] }];
    assert.equal(reportsStillMatchLastRun(previous, previous), true);
    assert.equal(reportsStillMatchLastRun([], previous), false);
    assert.equal(reportsStillMatchLastRun(previous, [...previous, { ...previous[0], xmlPath: '/module/target/TEST-Other.xml' }]), false);
    assert.equal(reportsStillMatchLastRun(
        [{ ...previous[0], suiteName: 'Changed' }],
        previous,
    ), false);
    assert.equal(reportsStillMatchLastRun(
        previous,
        [{ ...previous[0], testCases: [{
            className: 'Example', methodName: 'blocked', status: 'skipped', durationMs: 0,
            failureMessage: undefined, failureType: undefined, stackTrace: undefined,
            systemOut: undefined, systemErr: undefined, synthetic: true,
        }] }],
    ), true);
});
