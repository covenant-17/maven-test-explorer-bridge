import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { parseReportFile } from '../src/surefireParser';

test('preserves Surefire entities, CDATA, attributes, output, and timing', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mteb-surefire-'));
    const report = path.join(directory, 'TEST-example.xml');
    try {
        fs.writeFileSync(report, `<?xml version="1.0" encoding="UTF-8"?>
            <testsuite name="Example &amp; Integration" time="1.25">
              <testcase classname="example.LoginTest" name="opens&#39;profile" time="0.0025">
                <failure type="org.opentest4j.AssertionFailedError" message="Expected &lt;ready&gt; &amp; actual">
                  <![CDATA[org.opentest4j.AssertionFailedError: expected <ready>
    at example.LoginTest.opensProfile(LoginTest.java:42)]]>
                </failure>
                <system-out><![CDATA[user=<alice>&status=ready]]></system-out>
                <system-err>warn &amp; retry</system-err>
              </testcase>
            </testsuite>`, 'utf8');

        const result = parseReportFile(report);
        assert.ok(result);
        assert.equal(result.suiteName, 'Example & Integration');
        assert.equal(result.durationMs, 1250);
        assert.equal(result.testCases.length, 1);
        assert.deepEqual(result.testCases[0], {
            className: 'example.LoginTest',
            methodName: "opens'profile",
            status: 'failed',
            durationMs: 2.5,
            failureMessage: 'Expected <ready> & actual',
            failureType: 'org.opentest4j.AssertionFailedError',
            stackTrace: 'org.opentest4j.AssertionFailedError: expected <ready>\n    at example.LoginTest.opensProfile(LoginTest.java:42)',
            systemOut: 'user=<alice>&status=ready',
            systemErr: 'warn & retry',
        });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
