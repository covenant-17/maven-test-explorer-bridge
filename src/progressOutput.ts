import type { AgentRunStats } from './agentProtocol';
import type { RunOutcome } from './runPlanning';

/** Formats one scannable Maven progress line with explicit metric separators. */
export function formatTestProgress(
    passed: number,
    failed: number,
    skipped: number,
    remaining: number | undefined,
): string {
    const parts = [
        `✓ ${passed} passed`,
        `✗ ${failed} failed`,
        `⊘ ${skipped} skipped`,
    ];
    if (remaining !== undefined) {
        parts.push(`>> ${Math.max(0, remaining)} remaining`);
    }
    return `[Test Progress] ${parts.join(' │ ')}`;
}

/** Formats the single authoritative summary emitted when a managed Maven run ends. */
export function formatRunSummary(
    outcome: RunOutcome,
    stats: AgentRunStats,
    durationMs: number,
): string {
    const label = outcome === 'completed' ? 'PASSED' : outcome.toUpperCase();
    const outcomeIcon = outcome === 'completed' ? '✓' : outcome === 'failed' ? '✗' : '■';
    const total = stats.passed + stats.failed + stats.errors + stats.skipped;
    return `[Run Summary] ${outcomeIcon} ${label} │ Σ ${total} total │ ✓ ${stats.passed} passed │ `
        + `✗ ${stats.failed} failed │ ⊗ ${stats.errors} errors │ ⊘ ${stats.skipped} skipped │ `
        + `◷ ${formatRunDuration(durationMs)}`;
}

function formatRunDuration(durationMs: number): string {
    const boundedDuration = Math.max(0, durationMs);
    if (boundedDuration < 1000) {
        return `${Math.round(boundedDuration)}ms`;
    }
    return `${(boundedDuration / 1000).toFixed(1)}s`;
}
