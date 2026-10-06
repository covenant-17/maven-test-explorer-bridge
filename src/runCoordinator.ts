import {
    ActiveRunSnapshot,
    AgentRunFailure,
    AgentRunStats,
    ManagedRunStatus,
    OUTPUT_BUFFER_LIMIT,
    RunSource,
} from './agentProtocol';

interface MutableRun {
    runId: string;
    source: RunSource;
    label: string;
    status: ManagedRunStatus;
    command?: readonly string[];
    cwd?: string;
    pid?: number;
    startedAt: number;
    finishedAt?: number;
    currentClasses: Set<string>;
    completedClasses: Set<string>;
    totalClasses: number;
    stats: AgentRunStats;
    failures: readonly AgentRunFailure[];
    surefireSummary: string;
    output: string;
    outputTruncated: boolean;
}

interface RunWaiter {
    readonly resolve: (run: ActiveRunSnapshot) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

export class RunCoordinator {
    private active: MutableRun | undefined;
    private last: MutableRun | undefined;
    private readonly waiters = new Map<string, Set<RunWaiter>>();

    start(source: RunSource, label: string, totalClasses: number): ActiveRunSnapshot {
        if (this.active) {
            throw bridgeError('RUN_ALREADY_ACTIVE', 'A Maven test run is already active.', this.snapshot(this.active));
        }
        const startedAt = Date.now();
        this.active = {
            runId: `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            source,
            label,
            status: 'running',
            startedAt,
            currentClasses: new Set(),
            completedClasses: new Set(),
            totalClasses,
            stats: emptyStats(),
            failures: [],
            surefireSummary: formatSurefireSummary(emptyStats()),
            output: '',
            outputTruncated: false,
        };
        return this.snapshot(this.active);
    }

    setExecution(command: readonly string[], cwd: string, pid?: number): void {
        if (!this.active) return;
        this.active.command = [...command];
        this.active.cwd = cwd;
        this.active.pid = pid;
    }

    setPid(pid: number): void {
        if (this.active) this.active.pid = pid;
    }

    appendOutput(text: string): void {
        if (!this.active || text.length === 0) return;
        this.active.output += text;
        const bytes = Buffer.from(this.active.output, 'utf8');
        if (bytes.length > OUTPUT_BUFFER_LIMIT) {
            this.active.output = bytes.subarray(bytes.length - Math.floor(OUTPUT_BUFFER_LIMIT * 0.8)).toString('utf8');
            this.active.outputTruncated = true;
        }
    }

    classStarted(className: string): void {
        this.active?.currentClasses.add(className);
    }

    classCompleted(className: string): void {
        if (!this.active) return;
        this.active.currentClasses.delete(className);
        this.active.completedClasses.add(className);
    }

    setResults(stats: AgentRunStats, failures: readonly AgentRunFailure[]): void {
        if (!this.active) return;
        this.active.stats = stats;
        this.active.failures = failures.map((failure) => ({ ...failure }));
        this.active.surefireSummary = formatSurefireSummary(stats);
    }

    finish(status: Exclude<ManagedRunStatus, 'running'>): ActiveRunSnapshot | undefined {
        if (!this.active) return undefined;
        this.active.status = status;
        this.active.finishedAt = Date.now();
        this.active.currentClasses.clear();
        this.last = this.active;
        this.active = undefined;
        const snapshot = this.snapshot(this.last);
        const waiters = this.waiters.get(snapshot.runId);
        if (waiters) {
            this.waiters.delete(snapshot.runId);
            for (const waiter of waiters) {
                clearTimeout(waiter.timer);
                waiter.resolve(snapshot);
            }
        }
        return snapshot;
    }

    get activeRunId(): string | undefined {
        return this.active?.runId;
    }

    getStatus(): { active: boolean; run?: ActiveRunSnapshot; lastRun?: ActiveRunSnapshot } {
        return {
            active: Boolean(this.active),
            run: this.active ? this.snapshot(this.active) : undefined,
            lastRun: this.last ? this.snapshot(this.last) : undefined,
        };
    }

    waitForRun(runId: string, timeoutMs: number): Promise<ActiveRunSnapshot> {
        if (this.last?.runId === runId) {
            return Promise.resolve(this.snapshot(this.last));
        }
        if (!this.active || this.active.runId !== runId) {
            return Promise.reject(bridgeError('RUN_NOT_FOUND', 'The requested run was not found.'));
        }
        return new Promise((resolve, reject) => {
            const waiter: RunWaiter = {
                resolve,
                timer: setTimeout(() => {
                    const waiters = this.waiters.get(runId);
                    waiters?.delete(waiter);
                    if (waiters?.size === 0) this.waiters.delete(runId);
                    const run = this.active?.runId === runId ? this.snapshot(this.active) : undefined;
                    reject(bridgeError('RUN_WAIT_TIMEOUT', 'The Maven test run did not finish before the timeout.', { run }));
                }, timeoutMs),
            };
            const waiters = this.waiters.get(runId) ?? new Set<RunWaiter>();
            waiters.add(waiter);
            this.waiters.set(runId, waiters);
        });
    }

    getOutput(runId: string | undefined, tailLines = 200): { runId: string; output: string; truncated: boolean } {
        const run = this.matchRun(runId);
        const lines = run.output.split(/\r?\n/);
        if (lines.at(-1) === '') lines.pop();
        return {
            runId: run.runId,
            output: lines.slice(-Math.max(1, Math.min(1000, tailLines))).join('\n'),
            truncated: run.outputTruncated || lines.length > tailLines,
        };
    }

    assertActiveRun(runId: string): ActiveRunSnapshot {
        if (!this.active) {
            throw bridgeError('NO_ACTIVE_RUN', 'There is no active Maven test run.');
        }
        if (this.active.runId !== runId) {
            throw bridgeError('RUN_ID_MISMATCH', 'The requested run is no longer active.', this.snapshot(this.active));
        }
        return this.snapshot(this.active);
    }

    private matchRun(runId: string | undefined): MutableRun {
        if (this.active && (!runId || this.active.runId === runId)) return this.active;
        if (this.last && (!runId || this.last.runId === runId)) return this.last;
        throw bridgeError('RUN_NOT_FOUND', 'The requested run was not found.');
    }

    private snapshot(run: MutableRun): ActiveRunSnapshot {
        return {
            runId: run.runId,
            source: run.source,
            label: run.label,
            status: run.status,
            command: run.command,
            cwd: run.cwd,
            pid: run.pid,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            currentClasses: Array.from(run.currentClasses).sort(),
            completedClasses: run.completedClasses.size,
            totalClasses: run.totalClasses,
            stats: run.stats,
            failures: run.failures.map((failure) => ({ ...failure })),
            surefireSummary: run.surefireSummary,
        };
    }
}

export interface BridgeError extends Error {
    readonly code: string;
    readonly details?: unknown;
}

export function bridgeError(code: string, message: string, details?: unknown): BridgeError {
    return Object.assign(new Error(message), { code, details });
}

function emptyStats(): AgentRunStats {
    return { passed: 0, failed: 0, errors: 0, skipped: 0 };
}

function formatSurefireSummary(stats: AgentRunStats): string {
    const total = stats.passed + stats.failed + stats.errors + stats.skipped;
    return `Tests run: ${total}, Failures: ${stats.failed}, Errors: ${stats.errors}, Skipped: ${stats.skipped}`;
}
