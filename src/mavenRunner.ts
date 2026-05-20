import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionSettings } from './settings';
import { SUREFIRE_REPORTS_DIR, FAILSAFE_REPORTS_DIR } from './constants';

export interface MavenRunResult {
    readonly exitCode: number;
    readonly cancelled: boolean;
}

/**
 * Spawns a Maven process in the given working directory, streaming output to the provided
 * OutputChannel. Resolves with the exit code when the process finishes.
 *
 * Uses shell: true so that 'mvn' resolves to 'mvn.cmd' on Windows without extra configuration.
 */
// Surefire per-class summary line, e.g.:
//   Tests run: 5, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 30.5 s -- in tests.MyTest
const SUREFIRE_CLASS_SUMMARY = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/;

export function runMaven(
    cwd: string,
    args: readonly string[],
    outputChannel: vscode.OutputChannel,
    token: vscode.CancellationToken,
    totalExpected?: number,
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
        let runningErrors = 0;
        let runningSkipped = 0;
        let stdoutBuf = '';

        proc.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            outputChannel.append(text);

            stdoutBuf += text;
            let newlineIdx: number;
            while ((newlineIdx = stdoutBuf.indexOf('\n')) !== -1) {
                const line = stdoutBuf.slice(0, newlineIdx);
                stdoutBuf = stdoutBuf.slice(newlineIdx + 1);

                const m = SUREFIRE_CLASS_SUMMARY.exec(line);
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
                }
            }
        });

        proc.stderr.on('data', (chunk: Buffer) => {
            outputChannel.append(chunk.toString());
        });

        const cancellationSubscription = token.onCancellationRequested(() => {
            outputChannel.appendLine('[Maven] Run cancelled by user.');
            proc.kill();
            resolve({ exitCode: -1, cancelled: true });
        });

        proc.on('close', (code) => {
            cancellationSubscription.dispose();
            const exitCode = code ?? -1;
            outputChannel.appendLine('');
            outputChannel.appendLine(`[Maven] Exited with code ${exitCode}`);
            resolve({ exitCode, cancelled: false });
        });

        proc.on('error', (err) => {
            cancellationSubscription.dispose();
            outputChannel.appendLine(`[Maven] Process error: ${err.message}`);
            resolve({ exitCode: -1, cancelled: false });
        });
    });
}

/**
 * Builds Maven CLI arguments for running all tests.
 */
export function buildRunAllArgs(settings: ExtensionSettings): string[] {
    return [
        settings.mavenExecutable,
        ...buildProfileFlags(settings.defaultProfiles),
        ...splitArgs(settings.additionalArgs),
        ...settings.defaultCommand.split(/\s+/),
    ].filter(Boolean);
}

/**
 * Builds Maven CLI arguments for running a specific test class.
 */
export function buildRunClassArgs(settings: ExtensionSettings, className: string): string[] {
    return applyTemplate(settings.testClassCommandTemplate, settings, { className });
}

/**
 * Builds Maven CLI arguments for running a specific test method.
 */
export function buildRunMethodArgs(
    settings: ExtensionSettings,
    className: string,
    methodName: string,
): string[] {
    return applyTemplate(settings.testMethodCommandTemplate, settings, { className, methodName });
}

/**
 * Builds Maven CLI arguments for re-running a set of failed test classes.
 */
export function buildRerunFailedArgs(settings: ExtensionSettings, classNames: readonly string[]): string[] {
    if (classNames.length === 0) {
        return buildRunAllArgs(settings);
    }
    const testParam = classNames.join(',');
    return buildRunClassArgs(settings, testParam);
}

/**
 * Deletes only TEST-*.xml files from surefire-reports and failsafe-reports directories.
 * Avoids deleting JVM binary files (*.bin) that may still be locked by a running Java process.
 */
export function clearReportDirectories(moduleDir: string): void {
    for (const reportDir of [SUREFIRE_REPORTS_DIR, FAILSAFE_REPORTS_DIR]) {
        const fullPath = path.join(moduleDir, reportDir);
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
