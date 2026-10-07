export const RUNNING_SPINNER_CYCLE_MS = 2400;

export interface RunProgressLabels {
    readonly statusBarText: string;
    readonly viewMessage: string;
    readonly tooltip: string;
}

export function buildRunProgressLabels(completedClasses: number, totalClasses: number): RunProgressLabels {
    const completed = Math.max(0, Math.floor(completedClasses));
    const total = Math.max(0, Math.floor(totalClasses));
    if (total === 0) {
        return {
            statusBarText: '$(sync~spin) Maven Tests',
            viewMessage: 'Running tests',
            tooltip: 'Maven tests are running. Click to open Maven Test Explorer.',
        };
    }

    const boundedCompleted = Math.min(completed, total);
    return {
        statusBarText: `$(sync~spin) Maven Tests ${boundedCompleted}/${total}`,
        viewMessage: `${boundedCompleted}/${total} classes`,
        tooltip: `Maven tests: ${boundedCompleted} of ${total} classes completed. Click to open Maven Test Explorer.`,
    };
}
