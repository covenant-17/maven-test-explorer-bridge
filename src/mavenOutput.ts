/**
 * Keeps Maven's severity as the VS Code log category while moving a leading
 * timestamp out of the category position. Unknown output uses one stable
 * Maven category instead of creating arbitrary filter entries.
 */
export function categorizeMavenOutput(value: string): string {
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
