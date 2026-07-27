import * as path from 'path';
import { MavenModule } from './mavenProjectDetector';
import { buildFqcn, TestClassInfo } from './javaTestScanner';
import { SuiteResult, TestCaseResult, TestCaseStatus } from './surefireParser';
import { parseFilterExpression, TestFilterExpression } from './filterExpression';

export type CustomNodeKind = 'module' | 'package' | 'class' | 'method' | 'virtualMethod' | 'lifecycle';
export type CustomNodeStatus = TestCaseStatus | 'unknown';

export interface CustomNodeStats {
    passed: number;
    failed: number;
    error: number;
    skipped: number;
    total: number;
}

export interface CustomTestNode {
    id: string;
    kind: CustomNodeKind;
    label: string;
    description?: string;
    parentId?: string;
    children: CustomTestNode[];
    moduleId: string;
    moduleDir: string;
    packageName?: string;
    fqcn?: string;
    className?: string;
    methodName?: string;
    sourcePath?: string;
    line?: number;
    tags: string[];
    annotations: string[];
    status: CustomNodeStatus;
    stats: CustomNodeStats;
    durationMs?: number;
    isVirtual?: boolean;
    virtualParentId?: string;
    failureMessage?: string;
    failureType?: string;
    stackTrace?: string;
}

export interface CustomTreeSnapshot {
    roots: CustomTestNode[];
    nodesById: Map<string, CustomTestNode>;
    filteredRoots: CustomTestNode[];
    stats: CustomNodeStats;
    filterError?: string;
}

export interface ModuleClasses {
    module: MavenModule;
    classes: readonly TestClassInfo[];
}

const EMPTY_STATS: CustomNodeStats = { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 };

export function buildCustomTree(
    modulesWithClasses: readonly ModuleClasses[],
    suiteResults: readonly SuiteResult[],
    filterText: string | undefined,
): CustomTreeSnapshot {
    const nodesById = new Map<string, CustomTestNode>();
    const roots: CustomTestNode[] = [];
    const classByFqcn = new Map<string, CustomTestNode>();
    const methodByFqcnAndName = new Map<string, CustomTestNode>();
    const moduleByDir = new Map(modulesWithClasses.map(({ module }) => [module.moduleDir, module]));

    for (const { module, classes } of modulesWithClasses) {
        const moduleNode = createNode({
            id: moduleId(module),
            kind: 'module',
            label: module.artifactId,
            module,
        });
        roots.push(moduleNode);
        nodesById.set(moduleNode.id, moduleNode);

        const packageNodes = new Map<string, CustomTestNode>();
        const classesByPackage = groupClassesByPackage(classes);
        const packageNames = Array.from(classesByPackage.keys()).sort((a, b) => a.localeCompare(b));
        for (const packageName of packageNames) {
            const packageClasses = classesByPackage.get(packageName)!;
            const pkgId = packageId(module, packageName);
            const packageNode = createNode({
                id: pkgId,
                kind: 'package',
                label: packageName || '(default package)',
                parentId: moduleNode.id,
                module,
                packageName,
            });
            packageNodes.set(pkgId, packageNode);
            nodesById.set(packageNode.id, packageNode);
            moduleNode.children.push(packageNode);

            const classNodesByName = new Map<string, CustomTestNode>();
            for (const cls of packageClasses) {
                const fqcn = buildFqcn(cls.packageName, cls.className);
                const classNode = createNode({
                    id: classId(module, fqcn),
                    kind: 'class',
                    label: cls.displayName ?? displayClassName(cls.className),
                    description: cls.displayName ? cls.className : undefined,
                    parentId: packageNode.id,
                    module,
                    packageName: cls.packageName,
                    fqcn,
                    className: cls.className,
                    sourcePath: cls.filePath,
                    tags: [...cls.tags],
                    annotations: cls.tags.map((tag) => `@Tag("${tag}")`),
                });
                classNodesByName.set(cls.className, classNode);
                nodesById.set(classNode.id, classNode);
                classByFqcn.set(fqcn, classNode);
            }

            for (const cls of packageClasses) {
                const fqcn = buildFqcn(cls.packageName, cls.className);
                const classNode = classNodesByName.get(cls.className)!;
                for (const method of cls.methods) {
                    const tags = unique([...cls.tags, ...method.tags]);
                    const methodNode = createNode({
                        id: methodId(module, fqcn, method.name),
                        kind: 'method',
                        label: `${method.displayName ?? method.name}()`,
                        description: method.displayName ? method.name : undefined,
                        parentId: classNode.id,
                        module,
                        packageName: cls.packageName,
                        fqcn,
                        className: cls.className,
                        methodName: method.name,
                        sourcePath: cls.filePath,
                        line: method.line,
                        tags,
                        annotations: tags.map((tag) => `@Tag("${tag}")`),
                    });
                    classNode.children.push(methodNode);
                    nodesById.set(methodNode.id, methodNode);
                    methodByFqcnAndName.set(`${fqcn}#${method.name}`, methodNode);
                }
            }

            for (const cls of packageClasses) {
                const classNode = classNodesByName.get(cls.className)!;
                const parentClassName = directParentClassName(cls.className);
                const parentNode = parentClassName ? classNodesByName.get(parentClassName) : undefined;
                if (parentNode) {
                    classNode.parentId = parentNode.id;
                    parentNode.children.push(classNode);
                } else {
                    packageNode.children.push(classNode);
                }
            }
            organizeChildren(packageNode);
        }
    }

    materializeResults(suiteResults, modulesWithClasses, moduleByDir, nodesById, classByFqcn, methodByFqcnAndName);
    for (const root of roots) {
        organizeChildren(root);
    }
    rollupAll(roots);

    const filter = (filterText ?? '').trim();
    let filteredRoots = roots;
    let filterError: string | undefined;
    if (filter.length > 0) {
        try {
            const expression = parseFilterExpression(filter);
            filteredRoots = expression ? filterNodes(roots, expression) : roots;
        } catch (err) {
            filterError = err instanceof Error ? err.message : 'Invalid filter expression';
        }
    }

    return {
        roots,
        nodesById,
        filteredRoots,
        stats: sumStats(roots.map((node) => node.stats)),
        filterError,
    };
}

export function findRunnableClassTargets(node: CustomTestNode): string[] {
    if (node.kind === 'module') {
        return [];
    }
    if (node.kind === 'package') {
        const targets = new Set<string>();
        visit(node, (child) => {
            if (child.kind === 'class' && child.fqcn) {
                targets.add(simpleClassTarget(child.fqcn));
            }
        });
        return Array.from(targets);
    }
    if (node.kind === 'class' && node.fqcn) {
        return [simpleClassTarget(node.fqcn)];
    }
    if ((node.kind === 'method' || node.kind === 'virtualMethod' || node.kind === 'lifecycle') && node.fqcn && node.methodName) {
        const methodName = node.kind === 'virtualMethod' ? staticMethodName(node.methodName) : node.methodName;
        if (methodName.startsWith('@')) {
            return [simpleClassTarget(node.fqcn)];
        }
        return [`${simpleClassTarget(node.fqcn)}#${methodName}`];
    }
    return [];
}

export function nodePathLabel(node: CustomTestNode): string {
    if (node.kind === 'method' || node.kind === 'virtualMethod' || node.kind === 'lifecycle') {
        return node.fqcn && node.methodName ? `${node.fqcn}#${node.methodName}` : node.label;
    }
    return node.fqcn ?? node.packageName ?? node.label;
}

function materializeResults(
    suiteResults: readonly SuiteResult[],
    modulesWithClasses: readonly ModuleClasses[],
    moduleByDir: ReadonlyMap<string, MavenModule>,
    nodesById: Map<string, CustomTestNode>,
    classByFqcn: Map<string, CustomTestNode>,
    methodByFqcnAndName: Map<string, CustomTestNode>,
): void {
    for (const suite of suiteResults) {
        for (const tc of suite.testCases) {
            const module = findModuleForResult(tc, suite, modulesWithClasses, moduleByDir);
            if (!module) {
                continue;
            }
            let classNode = classByFqcn.get(tc.className);
            if (!classNode) {
                classNode = createResultOnlyClass(module, tc.className, nodesById, classByFqcn);
            }

            const exactMethod = methodByFqcnAndName.get(`${tc.className}#${tc.methodName}`);
            if (exactMethod) {
                applyCaseResult(exactMethod, tc);
                continue;
            }

            const parentMethodName = staticMethodName(tc.methodName);
            const parentMethod = methodByFqcnAndName.get(`${tc.className}#${parentMethodName}`);
            const kind: CustomNodeKind = tc.methodName.startsWith('@') ? 'lifecycle' : 'virtualMethod';
            const virtualId = `${classNode.id}#${encodeURIComponent(tc.methodName)}`;
            let node = nodesById.get(virtualId);
            if (!node) {
                node = createNode({
                    id: virtualId,
                    kind,
                    label: kind === 'lifecycle' ? tc.methodName : `${tc.methodName}()`,
                    description: kind === 'virtualMethod' ? 'virtual; opens parent' : undefined,
                    parentId: classNode.id,
                    module,
                    packageName: classNode.packageName,
                    fqcn: tc.className,
                    className: classNode.className,
                    methodName: tc.methodName,
                    sourcePath: parentMethod?.sourcePath ?? classNode.sourcePath,
                    line: parentMethod?.line ?? classNode.line,
                    tags: parentMethod?.tags ?? classNode.tags,
                    annotations: parentMethod?.annotations ?? classNode.annotations,
                    isVirtual: kind === 'virtualMethod',
                    virtualParentId: parentMethod?.id,
                });
                classNode.children.push(node);
                nodesById.set(node.id, node);
            }
            applyCaseResult(node, tc);
        }
    }
}

function createResultOnlyClass(
    module: MavenModule,
    fqcn: string,
    nodesById: Map<string, CustomTestNode>,
    classByFqcn: Map<string, CustomTestNode>,
): CustomTestNode {
    const pkg = fqcn.includes('.') ? fqcn.substring(0, fqcn.lastIndexOf('.')) : '';
    const simple = fqcn.substring(fqcn.lastIndexOf('.') + 1);
    const moduleNode = nodesById.get(moduleId(module));
    const pkgId = packageId(module, pkg);
    let packageNode = nodesById.get(pkgId);
    if (!packageNode) {
        packageNode = createNode({ id: pkgId, kind: 'package', label: pkg || '(default package)', parentId: moduleNode?.id, module, packageName: pkg });
        moduleNode?.children.push(packageNode);
        nodesById.set(packageNode.id, packageNode);
    }
    const classNode = createNode({
        id: classId(module, fqcn),
        kind: 'class',
        label: displayClassName(simple),
        parentId: packageNode.id,
        module,
        packageName: pkg,
        fqcn,
        className: simple,
    });
    packageNode.children.push(classNode);
    nodesById.set(classNode.id, classNode);
    classByFqcn.set(fqcn, classNode);
    return classNode;
}

function filterNodes(nodes: readonly CustomTestNode[], expression: TestFilterExpression): CustomTestNode[] {
    const filtered: CustomTestNode[] = [];
    for (const node of nodes) {
        const childMatches = filterNodes(node.children, expression);
        if (matchesNode(node, expression)) {
            filtered.push(cloneNode(node, node.children));
        } else if (childMatches.length > 0) {
            filtered.push(cloneNode(node, childMatches));
        }
    }
    return filtered;
}

function matchesNode(node: CustomTestNode, expression: TestFilterExpression): boolean {
    switch (expression.kind) {
        case 'term':
            return matchesTerm(node, expression.value);
        case 'and':
            return matchesNode(node, expression.left) && matchesNode(node, expression.right);
        case 'or':
            return matchesNode(node, expression.left) || matchesNode(node, expression.right);
    }
}

function matchesTerm(node: CustomTestNode, rawTerm: string): boolean {
    const term = rawTerm.trim();
    if (term.length === 0) {
        return true;
    }
    if (term.startsWith('@')) {
        const normalized = normalizeTag(term.substring(1));
        const tags = new Set(node.tags.map(normalizeTag));
        const statusTags = statusAliases(node.status);
        return tags.has(normalized) || statusTags.has(normalized);
    }
    const needle = term.toLocaleLowerCase();
    return [
        node.label,
        node.description ?? '',
        node.moduleId,
        node.packageName ?? '',
        node.fqcn ?? '',
        node.className ?? '',
        node.methodName ?? '',
        ...node.tags,
        ...node.annotations,
    ].some((value) => value.toLocaleLowerCase().includes(needle));
}

function rollupAll(nodes: readonly CustomTestNode[]): void {
    for (const node of nodes) {
        rollup(node);
    }
}

function rollup(node: CustomTestNode): CustomNodeStats {
    if (node.children.length === 0) {
        node.stats = leafStats(node.status);
        return node.stats;
    }
    for (const child of node.children) {
        rollup(child);
    }
    node.stats = sumStats(node.children.map((child) => child.stats));
    node.status = aggregateStatus(node.stats);
    return node.stats;
}

function applyCaseResult(node: CustomTestNode, tc: TestCaseResult): void {
    node.status = tc.status;
    node.durationMs = tc.durationMs;
    node.failureMessage = tc.failureMessage;
    node.failureType = tc.failureType;
    node.stackTrace = tc.stackTrace;
    node.stats = leafStats(tc.status);
}

function leafStats(status: CustomNodeStatus): CustomNodeStats {
    const stats = { ...EMPTY_STATS };
    if (status === 'passed') { stats.passed = 1; stats.total = 1; }
    else if (status === 'failed') { stats.failed = 1; stats.total = 1; }
    else if (status === 'error') { stats.error = 1; stats.total = 1; }
    else if (status === 'skipped') { stats.skipped = 1; stats.total = 1; }
    return stats;
}

function sumStats(stats: readonly CustomNodeStats[]): CustomNodeStats {
    return stats.reduce((acc, item) => ({
        passed: acc.passed + item.passed,
        failed: acc.failed + item.failed,
        error: acc.error + item.error,
        skipped: acc.skipped + item.skipped,
        total: acc.total + item.total,
    }), { ...EMPTY_STATS });
}

function aggregateStatus(stats: CustomNodeStats): CustomNodeStatus {
    if (stats.error > 0) { return 'error'; }
    if (stats.failed > 0) { return 'failed'; }
    if (stats.total > 0 && stats.total === stats.skipped) { return 'skipped'; }
    if (stats.passed > 0 && stats.failed === 0 && stats.error === 0) { return 'passed'; }
    return 'unknown';
}

function createNode(args: {
    id: string;
    kind: CustomNodeKind;
    label: string;
    module: MavenModule;
    parentId?: string;
    description?: string;
    packageName?: string;
    fqcn?: string;
    className?: string;
    methodName?: string;
    sourcePath?: string;
    line?: number;
    tags?: string[];
    annotations?: string[];
    isVirtual?: boolean;
    virtualParentId?: string;
}): CustomTestNode {
    return {
        id: args.id,
        kind: args.kind,
        label: args.label,
        description: args.description,
        parentId: args.parentId,
        children: [],
        moduleId: args.module.artifactId,
        moduleDir: args.module.moduleDir,
        packageName: args.packageName,
        fqcn: args.fqcn,
        className: args.className,
        methodName: args.methodName,
        sourcePath: args.sourcePath,
        line: args.line,
        tags: unique(args.tags ?? []),
        annotations: unique(args.annotations ?? []),
        status: 'unknown',
        stats: { ...EMPTY_STATS },
        isVirtual: args.isVirtual,
        virtualParentId: args.virtualParentId,
    };
}

function cloneNode(node: CustomTestNode, children: readonly CustomTestNode[]): CustomTestNode {
    return { ...node, children: children.map((child) => cloneNode(child, child.children)) };
}

function findModuleForResult(
    tc: TestCaseResult,
    suite: SuiteResult,
    modulesWithClasses: readonly ModuleClasses[],
    moduleByDir: ReadonlyMap<string, MavenModule>,
): MavenModule | undefined {
    for (const { module, classes } of modulesWithClasses) {
        if (classes.some((cls) => buildFqcn(cls.packageName, cls.className) === tc.className)) {
            return module;
        }
    }
    for (const [moduleDir, module] of moduleByDir) {
        if (suite.xmlPath.startsWith(moduleDir + path.sep) || suite.xmlPath.startsWith(moduleDir + '/')) {
            return module;
        }
    }
    return modulesWithClasses[0]?.module;
}

function staticMethodName(methodName: string): string {
    const paren = methodName.indexOf('(');
    const bracket = methodName.indexOf('[');
    const candidates = [paren, bracket].filter((idx) => idx > 0);
    if (candidates.length === 0) {
        return methodName;
    }
    return methodName.substring(0, Math.min(...candidates));
}

function simpleClassTarget(fqcn: string): string {
    return fqcn.substring(fqcn.lastIndexOf('.') + 1);
}

function displayClassName(className: string): string {
    return className.split('$').pop() ?? className;
}

function groupClassesByPackage(classes: readonly TestClassInfo[]): Map<string, TestClassInfo[]> {
    const grouped = new Map<string, TestClassInfo[]>();
    for (const cls of classes) {
        const existing = grouped.get(cls.packageName) ?? [];
        existing.push(cls);
        grouped.set(cls.packageName, existing);
    }
    return grouped;
}

function directParentClassName(className: string): string | undefined {
    const index = className.lastIndexOf('$');
    if (index < 0) {
        return undefined;
    }
    return className.substring(0, index);
}

function organizeChildren(node: CustomTestNode): void {
    const indexed = node.children.map((child, index) => ({ child, index }));
    indexed.sort((a, b) => {
        const groupDelta = childGroup(a.child) - childGroup(b.child);
        if (groupDelta !== 0) {
            return groupDelta;
        }
        return a.index - b.index;
    });
    node.children = indexed.map((entry) => entry.child);
    for (const child of node.children) {
        organizeChildren(child);
    }
}

function childGroup(node: CustomTestNode): number {
    if (node.kind === 'module' || node.kind === 'package' || node.kind === 'class') {
        return 0;
    }
    return 1;
}

function visit(node: CustomTestNode, callback: (node: CustomTestNode) => void): void {
    callback(node);
    for (const child of node.children) {
        visit(child, callback);
    }
}

function statusAliases(status: CustomNodeStatus): Set<string> {
    const aliases = new Set<string>();
    if (status === 'unknown') {
        return aliases;
    }
    aliases.add(`status.${status}`);
    aliases.add(status);
    aliases.add(`maventestexplorer:status.${status}`);
    if (status === 'error') {
        aliases.add('status.failed');
        aliases.add('failed');
        aliases.add('maventestexplorer:status.failed');
    }
    return aliases;
}

function normalizeTag(value: string): string {
    return value.toLocaleLowerCase().replace(/^maventestexplorer:/, '');
}

function moduleId(module: MavenModule): string {
    return `module:${module.artifactId}`;
}

function packageId(module: MavenModule, packageName: string): string {
    return `${moduleId(module)}/package:${packageName}`;
}

function classId(module: MavenModule, fqcn: string): string {
    return `${moduleId(module)}/class:${fqcn}`;
}

function methodId(module: MavenModule, fqcn: string, methodName: string): string {
    return `${classId(module, fqcn)}#${methodName}`;
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.length > 0)));
}
