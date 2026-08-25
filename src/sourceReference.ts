import * as path from 'path';
import type { CustomTestNode } from './customTestModel';

export function fullPathForNode(node: CustomTestNode): string | undefined {
    if (node.sourcePath) {
        const location = isSourceLine(node.line)
            ? `${node.sourcePath}:${node.line}`
            : node.sourcePath;
        return isMethodNode(node) && node.methodName
            ? `${methodSelector(node)} — ${location}`
            : node.sourcePath;
    }
    if (node.kind === 'module') {
        return node.moduleDir;
    }
    if (node.kind === 'package') {
        const descendantSourcePath = firstDescendantSourcePath(node);
        return descendantSourcePath ? path.dirname(descendantSourcePath) : node.moduleDir;
    }
    return undefined;
}

function methodSelector(node: CustomTestNode): string {
    const owner = node.fqcn ? `${node.fqcn}#` : '';
    const methodName = node.methodName ?? node.label;
    const method = methodName.endsWith(')') ? methodName : `${methodName}()`;
    return `${owner}${method}`;
}

function isMethodNode(node: CustomTestNode): boolean {
    return node.kind === 'method' || node.kind === 'virtualMethod' || node.kind === 'lifecycle';
}

function isSourceLine(line: number | undefined): line is number {
    return Number.isInteger(line) && (line ?? 0) > 0;
}

function firstDescendantSourcePath(node: CustomTestNode): string | undefined {
    for (const child of node.children) {
        if (child.sourcePath) {
            return child.sourcePath;
        }
        const nestedPath = firstDescendantSourcePath(child);
        if (nestedPath) {
            return nestedPath;
        }
    }
    return undefined;
}
