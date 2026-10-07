import * as assert from 'node:assert/strict';
import test from 'node:test';
import { parseActiveMavenProfiles } from '../src/mavenProfileResolver';

test('parses and deduplicates active Maven profiles across reactor modules', () => {
    assert.deepEqual(parseActiveMavenProfiles(`
[INFO] The following profiles are active:
[INFO]  - local (source: com.example:root:1.0)
[INFO]  - from-settings (source: external)
[INFO] The following profiles are active:
[INFO]  - local (source: com.example:child:1.0)
\u001b[32m[INFO]\u001b[0m  - child-only (source: com.example:child:1.0)
    `), ['child-only', 'from-settings', 'local']);
});

test('ignores unrelated Maven output', () => {
    assert.deepEqual(parseActiveMavenProfiles('[INFO] BUILD SUCCESS\n[WARNING] - not-a-profile'), []);
});
