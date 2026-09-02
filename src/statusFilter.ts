export type FilterNodeStatus = 'passed' | 'failed' | 'error' | 'skipped' | 'unknown';

export interface FilterNodeStats {
    readonly passed: number;
    readonly failed: number;
    readonly error: number;
    readonly skipped: number;
    readonly total: number;
}

export function matchesStatusFilter(
    status: FilterNodeStatus,
    stats: FilterNodeStats,
    normalized: string,
): boolean | undefined {
    const statusName = normalized.startsWith('status.') ? normalized.substring('status.'.length) : normalized;
    switch (statusName) {
        case 'passed':
            return status === 'passed' || stats.passed > 0;
        case 'failed':
            return status === 'failed' || status === 'error' || stats.failed > 0 || stats.error > 0;
        case 'error':
            return status === 'error' || stats.error > 0;
        case 'skipped':
            return status === 'skipped' || stats.skipped > 0;
        case 'executed':
            return status !== 'unknown' || stats.total > 0;
        default:
            return undefined;
    }
}

export function statusFilterFacets(status: FilterNodeStatus): string[] {
    switch (status) {
        case 'passed':
            return ['@passed', '@executed'];
        case 'failed':
            return ['@failed', '@executed'];
        case 'error':
            return ['@failed', '@error', '@executed'];
        case 'skipped':
            return ['@skipped', '@executed'];
        case 'unknown':
            return [];
    }
}
