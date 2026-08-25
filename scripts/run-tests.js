const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maven-test-explorer-tests-'));

try {
    const entryPoints = fs.readdirSync(testDir)
        .filter((name) => name.endsWith('.test.ts'))
        .map((name) => path.join(testDir, name));

    esbuild.buildSync({
        entryPoints,
        outdir: outputDir,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        sourcemap: 'inline',
        logLevel: 'silent',
    });

    const compiledTests = fs.readdirSync(outputDir)
        .filter((name) => name.endsWith('.test.js'))
        .map((name) => path.join(outputDir, name));
    const result = cp.spawnSync(process.execPath, ['--test', ...compiledTests], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
} finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
}
