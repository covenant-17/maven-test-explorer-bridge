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
export function runMaven(
    cwd: string,
    args: readonly string[],
    outputChannel: vscode.OutputChannel,
    token: vscode.CancellationToken,
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

        proc.stdout.on('data', (chunk: Buffer) => {
            outputChannel.append(chunk.toString());
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
    const testParam = classNames.join('+');
    return buildRunClassArgs(settings, testParam);
}

/**
 * Deletes the surefire-reports and failsafe-reports directories inside the given module directory.
 */
export function clearReportDirectories(moduleDir: string): void {
    for (const reportDir of [SUREFIRE_REPORTS_DIR, FAILSAFE_REPORTS_DIR]) {
        const fullPath = path.join(moduleDir, reportDir);
        if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
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
    return argsString
        .trim()
        .split(/\s+/)
        .filter((s) => s.length > 0);
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

    // Remove consecutive spaces and empty tokens introduced by empty placeholders
    return expanded.split(/\s+/).filter((s) => s.length > 0);
}
