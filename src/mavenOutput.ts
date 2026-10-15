import { stripVTControlCharacters } from 'node:util';

/**
 * Keeps Maven's severity as the VS Code log category while moving a leading
 * timestamp out of the category position. Unknown output uses one stable
 * Maven category instead of creating arbitrary filter entries.
 */
export function categorizeMavenOutput(value: string): string {
    value = stripVTControlCharacters(value);
    if (value.length === 0) {
        return value;
    }
    const timestampedLevel = /^(\[(?:\d{4}-\d{2}-\d{2}[ T])?\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?\])\s+(\[(?:trace|debug|info|warn|warning|error|fatal)\])\s*/i.exec(value);
    if (timestampedLevel) {
        return `${timestampedLevel[2]} ${timestampedLevel[1]} ${value.slice(timestampedLevel[0].length)}`;
    }
    if (/^\[(?:trace|debug|info|warn|warning|error|fatal)\](?:\s|$)/i.test(value)) {
        return value;
    }
    return `[Maven] ${value}`;
}

/** Frames each pipe independently so one log entry always contains one full line. */
export class MavenOutputStream {
    private pending = '';

    constructor(private readonly onLine: (line: string) => void) {}

    write(text: string): void {
        const value = this.pending + text;
        let start = 0;
        let end: number;
        while ((end = value.indexOf('\n', start)) !== -1) {
            this.onLine(value.slice(start, end).replace(/\r$/, ''));
            start = end + 1;
        }
        this.pending = value.slice(start);
    }

    flush(): void {
        if (this.pending.length > 0) {
            const line = this.pending;
            this.pending = '';
            this.onLine(line.replace(/\r$/, ''));
        }
    }
}
