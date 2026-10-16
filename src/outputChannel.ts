import type * as vscode from 'vscode';

type MessageLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error';
const LEVELS: Record<MessageLevel, number> = { trace: 1, debug: 2, info: 3, warning: 4, error: 5 };

/**
 * Uses a regular text OutputChannel so native filtering works on actual lines,
 * without the separate log-entry index that can drift during log rotation.
 */
export class MavenOutputChannel implements vscode.OutputChannel {
    constructor(
        private readonly channel: vscode.OutputChannel,
        private readonly getLogLevel: () => vscode.LogLevel,
        private readonly now: () => Date = () => new Date(),
    ) {}

    get name(): string { return this.channel.name; }

    append(value: string): void { this.write('info', value); }
    appendLine(value: string): void { this.write('info', value); }
    trace(value: string): void { this.write('trace', value); }
    debug(value: string): void { this.write('debug', value); }
    info(value: string): void { this.write('info', value); }
    warn(value: string): void { this.write('warning', value); }
    error(value: string): void { this.write('error', value); }

    clear(): void { this.channel.clear(); }
    replace(value: string): void { this.channel.replace(this.format('info', value).join('')); }
    hide(): void { this.channel.hide(); }
    dispose(): void { this.channel.dispose(); }

    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        if (typeof columnOrPreserveFocus === 'number') {
            this.channel.show(columnOrPreserveFocus, preserveFocus);
        } else {
            this.channel.show(columnOrPreserveFocus);
        }
    }

    private write(level: MessageLevel, value: string): void {
        if (LEVELS[level] >= this.getLogLevel()) {
            this.channel.append(this.format(level, value).join(''));
        }
    }

    private format(level: MessageLevel, value: string): string[] {
        const date = this.now();
        const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
        const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
            + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
        // Severity must precede the date: a canonical timestamp-first header
        // would reactivate VS Code's log-entry parser even on a text channel.
        return value.split(/\r\n|\r|\n/).map(line => `[${level}] ${timestamp} ${line}\n`);
    }
}
