import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { ReportChangeTracker } from '../src/reportChangeTracker';

test('ignores pre-existing reports and detects changed or new reports', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mteb-reports-'));
    const oldReport = path.join(directory, 'TEST-old.xml');
    const newReport = path.join(directory, 'TEST-new.xml');
    try {
        fs.writeFileSync(oldReport, '<testsuite/>');
        const tracker = new ReportChangeTracker([oldReport]);
        assert.deepEqual(tracker.changedFiles([oldReport]), []);

        fs.writeFileSync(oldReport, '<testsuite tests="1"/>');
        fs.writeFileSync(newReport, '<testsuite/>');
        assert.deepEqual(tracker.changedFiles([oldReport, newReport]).sort(), [newReport, oldReport].sort());

        tracker.markSeen(oldReport);
        tracker.markSeen(newReport);
        assert.deepEqual(tracker.changedFiles([oldReport, newReport]), []);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
