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
