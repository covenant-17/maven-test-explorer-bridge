import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionSettings } from './settings';
import { SUREFIRE_REPORTS_DIR, FAILSAFE_REPORTS_DIR } from './constants';
import { ensureNonRecursiveArgs } from './runPlanning';

export interface MavenRunResult {
    readonly exitCode: number;
    readonly cancelled: boolean;
}

export interface MavenRunProgressHandlers {
    readonly onClassStarted?: (className: string) => void;
    readonly onClassCompleted?: (className: string) => void;
}

/**
 * Spawns a Maven process in the given working directory, streaming output to the provided
 * OutputChannel. Resolves with the exit code when the process finishes.
 *
 * Uses shell: true so that 'mvn' resolves to 'mvn.cmd' on Windows without extra configuration.
 */
// Surefire per-class summary line, e.g.:
//   Tests run: 5, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 30.5 s -- in tests.MyTest
const SUREFIRE_CLASS_START = /(?:^|\s)Running\s+([\w.$]+)\s*$/;
const SUREFIRE_CLASS_SUMMARY = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+).*-- in\s+([\w.$]+)/;

export function runMaven(
    cwd: string,
    args: readonly string[],
    outputChannel: vscode.OutputChannel,
    token: vscode.CancellationToken,
    totalExpected?: number,
    progressHandlers?: MavenRunProgressHandlers,
): Promise<MavenRunResult> {
    return new Promise((resolve) => {
        const executable = args[0];
        const spawnArgs = args.slice(1);

        outputChannel.appendLine('');
        outputChannel.appendLine(`[Maven] Running in: ${cwd}`);
        outputChannel.appendLine(`[Maven] Command: ${args.join(' ')}`);
        outputChannel.appendLine('');

        const proc = cp.spawn(executable, spawnArgs, {
            cwd,
            shell: true,
            env: process.env,
        });

        let runningPassed = 0;
        let runningFailed = 0;
        let runningSkipped = 0;
        let stdoutBuf = '';
        let cancellationRequested = false;
        let settled = false;

        const finish = (result: MavenRunResult): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };

        proc.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            outputChannel.append(text);

            stdoutBuf += text;
            let newlineIdx: number;
            while ((newlineIdx = stdoutBuf.indexOf('\n')) !== -1) {
                const line = stdoutBuf.slice(0, newlineIdx);
                stdoutBuf = stdoutBuf.slice(newlineIdx + 1);

                const progressLine = line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
                const started = SUREFIRE_CLASS_START.exec(progressLine);
                if (started) {
                    progressHandlers?.onClassStarted?.(started[1]);
                }

                const m = SUREFIRE_CLASS_SUMMARY.exec(progressLine);
                if (m) {
                    const classTotal    = parseInt(m[1], 10);
                    const classFailed   = parseInt(m[2], 10);
                    const classErrors   = parseInt(m[3], 10);
                    const classSkipped  = parseInt(m[4], 10);
                    const classPassed   = classTotal - classFailed - classErrors - classSkipped;
                    runningPassed  += classPassed;
                    runningFailed  += classFailed + classErrors;
                    runningSkipped += classSkipped;
                    const done = runningPassed + runningFailed + runningSkipped;
                    const remaining = totalExpected !== undefined ? totalExpected - done : undefined;
                    const parts = [
                        `✓ ${runningPassed} passed`,
                        `✗ ${runningFailed} failed`,
                        `⊘ ${runningSkipped} skipped`,
                    ];
                    if (remaining !== undefined) {
                        parts.push(`⏳ ${Math.max(0, remaining)} remaining`);
                    }
                    outputChannel.appendLine(`[Progress] ${parts.join('  ')}`);
                    progressHandlers?.onClassCompleted?.(m[5]);
                }
            }
        });

        proc.stderr.on('data', (chunk: Buffer) => {
            outputChannel.append(chunk.toString());
        });

        const cancellationSubscription = token.onCancellationRequested(() => {
            if (cancellationRequested) {
                return;
            }
            cancellationRequested = true;
            outputChannel.appendLine('[Maven] Run cancelled by user.');
            killProcessTree(proc, outputChannel);
        });

        proc.on('close', (code) => {
            cancellationSubscription.dispose();
            const exitCode = code ?? -1;
            outputChannel.appendLine('');
            outputChannel.appendLine(`[Maven] Exited with code ${exitCode}`);
            finish({ exitCode, cancelled: cancellationRequested });
        });

        proc.on('error', (err) => {
            cancellationSubscription.dispose();
            outputChannel.appendLine(`[Maven] Process error: ${err.message}`);
            finish({ exitCode: -1, cancelled: cancellationRequested });
        });
    });
}

/**
 * Builds Maven CLI arguments for running all tests.
 */
export function buildRunAllArgs(settings: ExtensionSettings, nonRecursive = false): string[] {
    return ensureNonRecursiveArgs([
        settings.mavenExecutable,
        ...buildProfileFlags(settings.defaultProfiles),
        ...splitArgs(settings.additionalArgs),
        ...settings.defaultCommand.split(/\s+/),
    ].filter(Boolean), nonRecursive);
}

/**
 * Builds Maven CLI arguments for running a specific test class.
 */
export function buildRunClassArgs(
    settings: ExtensionSettings,
    className: string,
    nonRecursive = false,
): string[] {
    return ensureNonRecursiveArgs(
        applyTemplate(settings.testClassCommandTemplate, settings, { className }),
        nonRecursive,
    );
}

/**
 * Builds Maven CLI arguments for re-running a set of failed test classes.
 */
export function buildRerunFailedArgs(
    settings: ExtensionSettings,
    classNames: readonly string[],
    nonRecursive = false,
): string[] {
    if (classNames.length === 0) {
        return buildRunAllArgs(settings, nonRecursive);
    }
    const testParam = classNames.join(',');
    return buildRunClassArgs(settings, testParam, nonRecursive);
}

/**
 * Deletes only TEST-*.xml files from surefire-reports and failsafe-reports directories.
 * Avoids deleting JVM binary files (*.bin) that may still be locked by a running Java process.
 */
export function clearReportDirectories(
    moduleDir: string,
    reportGlobs: readonly string[] = [
        `**/${SUREFIRE_REPORTS_DIR}/TEST-*.xml`,
        `**/${FAILSAFE_REPORTS_DIR}/TEST-*.xml`,
    ],
): void {
    for (const fullPath of reportDirectories(moduleDir, reportGlobs)) {
        if (!fs.existsSync(fullPath)) {
            continue;
        }
        for (const entry of fs.readdirSync(fullPath)) {
            if (!entry.startsWith('TEST-') || !entry.endsWith('.xml')) {
                continue;
            }
            try {
                fs.unlinkSync(path.join(fullPath, entry));
            } catch {
                // File may be locked by a concurrent JVM — skip silently
            }
        }
    }
}

function reportDirectories(moduleDir: string, reportGlobs: readonly string[]): Set<string> {
    const directories = new Set<string>();
    for (const glob of reportGlobs) {
        const normalized = glob.replace(/\\/g, '/').replace(/^\*+\//, '');
        const separator = normalized.lastIndexOf('/');
        const relativeDir = separator >= 0 ? normalized.slice(0, separator) : '';
        directories.add(path.join(moduleDir, relativeDir));
    }
    return directories;
}

/**
 * Resolves the Maven executable to use for the given module directory.
 * When preferMavenWrapper is enabled, searches for mvnw / mvnw.cmd in the
 * module directory and its immediate parent (to support multi-module layouts).
 * Falls back to settings.mavenExecutable if no wrapper is found.
 */
export function resolveExecutable(settings: ExtensionSettings, moduleDir: string): string {
    if (!settings.preferMavenWrapper) {
        return settings.mavenExecutable;
    }
    const wrapperName = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
    const candidates = [moduleDir, path.dirname(moduleDir)];
    for (const dir of candidates) {
        const wrapperPath = path.join(dir, wrapperName);
        if (fs.existsSync(wrapperPath)) {
            return wrapperPath;
        }
    }
    return settings.mavenExecutable;
}

// -------------------------------------------------------------------------
// Private helpers
// -------------------------------------------------------------------------

function buildProfileFlags(profiles: readonly string[]): string[] {
    if (profiles.length === 0) {
        return [];
    }
    return [`-P${profiles.join(',')}`];
}

function splitArgs(argsString: string): string[] {
    return tokenizeArgs(argsString);
}

function applyTemplate(
    template: string,
    settings: ExtensionSettings,
    vars: { className: string; methodName?: string },
): string[] {
    const profileFlag = buildProfileFlags(settings.defaultProfiles).join(' ');
    const additionalArgs = settings.additionalArgs.trim();

    const expanded = template
        .replace('{maven}', settings.mavenExecutable)
        .replace('{profiles}', profileFlag)
        .replace('{args}', additionalArgs)
        .replace('{className}', vars.className)
        .replace('{methodName}', vars.methodName ?? '');

    // Parse template output while preserving quoted arguments (e.g. paths with spaces).
    return tokenizeArgs(expanded);
}

function tokenizeArgs(value: string): string[] {
    const tokens: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
    for (const match of value.matchAll(re)) {
        const token = match[1] ?? match[2] ?? match[3];
        if (token && token.length > 0) {
            tokens.push(token);
        }
    }
    return tokens;
}

/**
 * Terminates a spawned process and its entire child process tree.
 *
 * On Windows, `proc.kill()` only kills the immediate shell wrapper (cmd.exe)
 * spawned by `shell: true`, leaving the Java/Maven subprocess alive.
 * `taskkill /F /T /PID` kills the full tree including all descendants.
 * On non-Windows platforms the standard SIGTERM is sufficient.
 */
function killProcessTree(proc: cp.ChildProcess, outputChannel: vscode.OutputChannel): void {
    if (process.platform === 'win32' && proc.pid !== undefined) {
        cp.spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { shell: false })
            .on('error', (err) => {
                outputChannel.appendLine(`[Maven] taskkill error: ${err.message} — falling back to proc.kill()`);
                proc.kill();
            });
    } else {
        proc.kill();
    }
}
