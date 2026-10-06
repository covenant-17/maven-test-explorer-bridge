import * as fs from 'fs';

export class ReportChangeTracker {
    private readonly seen = new Map<string, string>();

    constructor(initialPaths: readonly string[]) {
        for (const filePath of initialPaths) this.seen.set(filePath, fileSignature(filePath));
    }

    changedFiles(paths: readonly string[]): string[] {
        return paths.filter((filePath) => this.seen.get(filePath) !== fileSignature(filePath));
    }

    markSeen(filePath: string): void {
        this.seen.set(filePath, fileSignature(filePath));
    }
}

function fileSignature(filePath: string): string {
    try {
        const stat = fs.statSync(filePath);
        return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    } catch {
        return 'missing';
    }
}
