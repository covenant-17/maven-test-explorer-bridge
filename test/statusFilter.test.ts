import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesStatusFilter, statusFilterFacets } from '../src/statusFilter';

const mixedStats = { passed: 3, failed: 1, error: 1, skipped: 2, total: 7 };

test('status filters match aggregate container counters', () => {
    assert.equal(matchesStatusFilter('error', mixedStats, 'passed'), true);
    assert.equal(matchesStatusFilter('error', mixedStats, 'failed'), true);
    assert.equal(matchesStatusFilter('error', mixedStats, 'error'), true);
    assert.equal(matchesStatusFilter('error', mixedStats, 'skipped'), true);
    assert.equal(matchesStatusFilter('error', mixedStats, 'executed'), true);
});

test('failed includes errors but excludes a fully passed node', () => {
    const passedStats = { passed: 2, failed: 0, error: 0, skipped: 0, total: 2 };
    assert.equal(matchesStatusFilter('error', passedStats, 'failed'), true);
    assert.equal(matchesStatusFilter('passed', passedStats, 'failed'), false);
    assert.equal(matchesStatusFilter('passed', passedStats, 'status.passed'), true);
});

test('unknown at-terms remain available to tag and annotation matching', () => {
    assert.equal(matchesStatusFilter('unknown', mixedStats, 'smoke'), undefined);
});

test('autocomplete facets cover every persisted result status', () => {
    assert.deepEqual(statusFilterFacets('passed'), ['@passed', '@executed']);
    assert.deepEqual(statusFilterFacets('failed'), ['@failed', '@executed']);
    assert.deepEqual(statusFilterFacets('error'), ['@failed', '@error', '@executed']);
    assert.deepEqual(statusFilterFacets('skipped'), ['@skipped', '@executed']);
    assert.deepEqual(statusFilterFacets('unknown'), []);
});
