const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const contribution = packageJson.contributes?.grammars?.find(
    (grammar) => grammar.scopeName === 'maven-test-explorer.output.injection',
);
assert.ok(contribution, 'Output grammar contribution is missing from package.json.');
assert.deepEqual(contribution.injectTo, ['text.log']);

const grammarPath = path.resolve(rootDir, contribution.path);
const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
assert.equal(grammar.scopeName, contribution.scopeName);
assert.equal(grammar.injectionSelector, 'L:text.log');

const patterns = grammar.patterns.filter((pattern) => typeof pattern.match === 'string');
for (const pattern of patterns) {
    new RegExp(pattern.match, 'u');
}

function matchingScopes(line) {
    return patterns
        .filter((pattern) => new RegExp(pattern.match, 'u').test(line))
        .map((pattern) => pattern.name)
        .filter(Boolean);
}

const passedSummary = patterns.find((pattern) => new RegExp(pattern.match, 'u').test(
    '2026-10-07 11:15:14.101 [info] [Run Summary] ✓ PASSED │ Σ 3 total │ ✓ 3 passed │ ✗ 0 failed │ ⊗ 0 errors │ ⊘ 0 skipped │ ◷ 1.2s',
));
assert.equal(passedSummary?.captures?.['2']?.name, 'markup.inserted.maven-test-explorer');
assert.equal(passedSummary?.captures?.['8']?.name, 'markup.inserted.maven-test-explorer');

const failedSummary = patterns.find((pattern) => new RegExp(pattern.match, 'u').test(
    '2026-10-07 11:15:14.101 [info] [Run Summary] ✗ FAILED │ Σ 3 total │ ✓ 2 passed │ ✗ 1 failed │ ⊗ 0 errors │ ⊘ 0 skipped │ ◷ 1.2s',
));
assert.equal(failedSummary?.captures?.['2']?.name, 'token.error-token');
assert.equal(failedSummary?.captures?.['8']?.name, 'markup.inserted.maven-test-explorer');
assert.equal(failedSummary?.captures?.['11']?.name, 'token.error-token');
assert.equal(failedSummary?.captures?.['14']?.name, 'token.error-token');
assert.ok(matchingScopes('2026-10-07 11:15:14.101 [info] [ERROR] Maven compilation failed')
    .includes('markup.deleted.maven-test-explorer'));

const progressPattern = patterns.find((pattern) => pattern.match.includes('Test Progress') && pattern.captures);
assert.ok(progressPattern, 'Detailed Test Progress grammar rule is missing.');
const progressMatch = new RegExp(progressPattern.match, 'u').exec(
    '2026-10-07 11:15:14.101 [info] [Test Progress] ✓ 471 passed │ ✗ 128 failed │ ⊘ 36 skipped │ >> 2904 remaining',
);
assert.ok(progressMatch, 'Test Progress sample does not match the output grammar.');
assert.equal(progressMatch[2], '✓');
assert.equal(progressMatch[6], '✗');
assert.equal(progressMatch[10], '⊘');
assert.equal(progressMatch[14], '>>');
assert.equal(progressMatch[15], '2904');
assert.equal(progressPattern.captures['6'].name, 'token.error-token');
assert.equal(progressPattern.captures['14'].name, 'token.warn-token');

console.log('[validate-output-grammar] Contribution, regular expressions, and representative log lines are valid.');
