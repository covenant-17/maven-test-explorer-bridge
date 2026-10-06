/** Formats a local timestamp for Maven progress output as DD/MM/YYYY - HH:mm:ss. */
export function formatProgressDateTime(date: Date): string {
    const twoDigits = (value: number): string => String(value).padStart(2, '0');

    return [
        twoDigits(date.getDate()),
        twoDigits(date.getMonth() + 1),
        date.getFullYear(),
    ].join('/') + ' - ' + [
        twoDigits(date.getHours()),
        twoDigits(date.getMinutes()),
        twoDigits(date.getSeconds()),
    ].join(':');
}

/** Formats one scannable Maven progress line with explicit metric separators. */
export function formatTestProgress(
    passed: number,
    failed: number,
    skipped: number,
    remaining: number | undefined,
    date: Date,
): string {
    const parts = [
        `✓ ${passed} passed`,
        `✗ ${failed} failed`,
        `⊘ ${skipped} skipped`,
    ];
    if (remaining !== undefined) {
        parts.push(`⏳ ${Math.max(0, remaining)} remaining`);
    }
    parts.push(formatProgressDateTime(date));
    return `[Test Progress] ${parts.join(' │ ')}`;
}
