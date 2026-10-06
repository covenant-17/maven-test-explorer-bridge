import { ActiveRunSnapshot, AgentRunStats, ManagedRunStatus, OUTPUT_BUFFER_LIMIT, RunSource } from './agentProtocol';

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
    output: string;
    outputTruncated: boolean;
}

export class RunCoordinator {
    private active: MutableRun | undefined;
    private last: MutableRun | undefined;

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

    setStats(stats: AgentRunStats): void {
        if (this.active) this.active.stats = stats;
    }

    finish(status: Exclude<ManagedRunStatus, 'running'>): ActiveRunSnapshot | undefined {
        if (!this.active) return undefined;
        this.active.status = status;
        this.active.finishedAt = Date.now();
        this.active.currentClasses.clear();
        this.last = this.active;
        this.active = undefined;
        return this.snapshot(this.last);
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
