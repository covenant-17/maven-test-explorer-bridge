import spawn from 'cross-spawn';
import * as cp from 'child_process';

export interface ActiveProfileResolution {
    readonly profiles: readonly string[];
    readonly exitCode: number;
    readonly error?: string;
}

const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ACTIVE_PROFILE_LINE = /^\s*(?:\[INFO\]\s*)?-\s+([^\s(]+)\s+\(source:/;
const ACTIVE_PROFILES_GOAL = 'org.apache.maven.plugins:maven-help-plugin:3.5.2:active-profiles';

export function parseActiveMavenProfiles(output: string): string[] {
    const profiles = new Set<string>();
    for (const rawLine of output.split(/\r?\n/)) {
        const match = ACTIVE_PROFILE_LINE.exec(rawLine.replace(ANSI_ESCAPE, ''));
        if (match) profiles.add(match[1]);
    }
    return Array.from(profiles).sort((left, right) => left.localeCompare(right));
}

export function resolveActiveMavenProfiles(
    cwd: string,
    executable: string,
    selectedProfiles: readonly string[],
    activationArgs: readonly string[] = [],
    timeoutMs = 30_000,
): Promise<ActiveProfileResolution> {
    return new Promise((resolve) => {
        const args = [
            ...(selectedProfiles.length > 0 ? [`-P${selectedProfiles.join(',')}`] : []),
            ...activationArgs,
            ACTIVE_PROFILES_GOAL,
        ];
        const proc = spawn(executable, args, { cwd, shell: false, env: process.env });
        let output = '';
        let settled = false;
        const finish = (result: ActiveProfileResolution): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const append = (chunk: Buffer): void => {
            if (output.length < 1024 * 1024) output += chunk.toString();
        };
        proc.stdout?.on('data', append);
        proc.stderr?.on('data', append);
        proc.on('close', (code) => {
            const exitCode = code ?? -1;
            finish({
                profiles: parseActiveMavenProfiles(output),
                exitCode,
                error: exitCode === 0 ? undefined : lastMeaningfulLine(output) || `Maven exited with code ${exitCode}.`,
            });
        });
        proc.on('error', (error) => finish({ profiles: [], exitCode: -1, error: error.message }));
        const timer = setTimeout(() => {
            if (process.platform === 'win32' && proc.pid !== undefined) {
                cp.spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { shell: false })
                    .on('error', () => proc.kill());
            } else {
                proc.kill();
            }
            finish({ profiles: parseActiveMavenProfiles(output), exitCode: -1, error: 'Maven profile detection timed out.' });
        }, timeoutMs);
    });
}

function lastMeaningfulLine(output: string): string | undefined {
    return output
        .replace(ANSI_ESCAPE, '')
        .split(/\r?\n/)
        .map((line) => line.replace(/^\[[A-Z]+\]\s*/, '').trim())
        .filter(Boolean)
        .at(-1);
}
