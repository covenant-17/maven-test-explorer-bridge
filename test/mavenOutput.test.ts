import assert from 'node:assert/strict';
import test from 'node:test';
import { categorizeMavenOutput } from '../src/mavenOutput';

test('moves the Maven level before a bracketed timestamp so VS Code does not treat seconds as categories', () => {
    assert.equal(
        categorizeMavenOutput('[10:31:14.399] [INFO] Running test'),
        '[INFO] [10:31:14.399] Running test',
    );
    assert.equal(
        categorizeMavenOutput('[2026-10-08 10:31:14,399] [ERROR] Failure'),
        '[ERROR] [2026-10-08 10:31:14,399] Failure',
    );
});

test('preserves Maven levels and uses a stable category for uncategorized output', () => {
    assert.equal(categorizeMavenOutput('[ERROR] Failure'), '[ERROR] Failure');
    assert.equal(
        categorizeMavenOutput('[10:31:14.399] Browser test started'),
        '[Maven] [10:31:14.399] Browser test started',
    );
    assert.equal(categorizeMavenOutput('Downloading dependency'), '[Maven] Downloading dependency');
    assert.equal(categorizeMavenOutput(''), '');
});
