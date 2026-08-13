import * as path from 'path';
import { MavenModule } from './mavenProjectDetector';
import { buildFqcn, SourceAnnotation, TestClassInfo } from './javaTestScanner';
import { SuiteResult, TestCaseResult, TestCaseStatus } from './surefireParser';
import { parseFilterExpression, TestFilterExpression } from './filterExpression';

export type CustomNodeKind = 'module' | 'package' | 'class' | 'method' | 'virtualMethod' | 'lifecycle';
export type CustomNodeStatus = TestCaseStatus | 'unknown';
export type CustomSortMode = 'location' | 'name' | 'status' | 'duration';
export type CustomSortDirection = 'asc' | 'desc';

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
    sourceAnnotations: SourceAnnotation[];
    status: CustomNodeStatus;
    running?: boolean;
    stats: CustomNodeStats;
    durationMs?: number;
    isVirtual?: boolean;
    virtualParentId?: string;
    hasVirtualInvocations?: boolean;
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

export interface CustomTreeRuntimeState {
    readonly runningNodeIds?: ReadonlySet<string>;
    readonly suiteResults?: readonly SuiteResult[];
    readonly sortMode?: CustomSortMode;
    readonly sortDirection?: CustomSortDirection;
}

const EMPTY_STATS: CustomNodeStats = { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 };

export function buildCustomTree(
    modulesWithClasses: readonly ModuleClasses[],
    suiteResults: readonly SuiteResult[],
    filterText: string | undefined,
    runtimeState?: CustomTreeRuntimeState,
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
                    annotations: [
                        ...cls.tags.map((tag) => `@Tag("${tag}")`),
                        ...cls.annotations.map(formatSourceAnnotation),
                    ],
                    sourceAnnotations: [...cls.annotations],
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
                    const sourceAnnotations = uniqueSourceAnnotations([...cls.annotations, ...method.annotations]);
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
                        annotations: [
                            ...tags.map((tag) => `@Tag("${tag}")`),
                            ...sourceAnnotations.map(formatSourceAnnotation),
                        ],
                        sourceAnnotations,
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
    const completedRuntimeNodeIds = materializeResults(runtimeState?.suiteResults ?? [], modulesWithClasses, moduleByDir, nodesById, classByFqcn, methodByFqcnAndName);
    rollupAll(roots);
    for (const root of roots) {
        organizeChildren(
            root,
            runtimeState?.sortMode ?? 'location',
            runtimeState?.sortDirection ?? 'asc',
        );
    }
    applyRunningState(roots, runtimeState?.runningNodeIds, completedRuntimeNodeIds);

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
): Set<string> {
    const resolvedNodeIds = new Set<string>();
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
            addSubtreeIds(resolvedNodeIds, classNode);

            const exactMethod = methodByFqcnAndName.get(`${tc.className}#${tc.methodName}`);
            if (exactMethod) {
                applyCaseResult(exactMethod, tc);
                resolvedNodeIds.add(exactMethod.id);
                continue;
            }

            const parentMethodName = staticMethodName(tc.methodName);
            const parentMethod = methodByFqcnAndName.get(`${tc.className}#${parentMethodName}`);
            const kind: CustomNodeKind = tc.methodName.startsWith('@') ? 'lifecycle' : 'virtualMethod';
            if (parentMethod && kind === 'virtualMethod') {
                parentMethod.hasVirtualInvocations = true;
            }
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
                    sourceAnnotations: parentMethod?.sourceAnnotations ?? classNode.sourceAnnotations,
                    isVirtual: kind === 'virtualMethod',
                    virtualParentId: parentMethod?.id,
                });
                classNode.children.push(node);
                nodesById.set(node.id, node);
            }
            applyCaseResult(node, tc);
            resolvedNodeIds.add(node.id);
        }
    }
    return resolvedNodeIds;
}

function addSubtreeIds(target: Set<string>, node: CustomTestNode): void {
    target.add(node.id);
    for (const child of node.children) {
        addSubtreeIds(target, child);
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
        if (statusTags.has(normalized)) {
            return true;
        }
        const namespacePrefix = `${path.basename(node.moduleDir).toLocaleLowerCase()}.`;
        const annotationPrefix = `${namespacePrefix}annotation.`;
        if (normalized.startsWith(annotationPrefix)) {
            return matchesAnnotationFilter(node.sourceAnnotations, normalized.substring(annotationPrefix.length));
        }
        const tagName = normalized.startsWith(namespacePrefix)
            ? normalized.substring(namespacePrefix.length)
            : normalized;
        return tags.has(tagName);
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

function applyRunningState(
    nodes: readonly CustomTestNode[],
    runningNodeIds: ReadonlySet<string> | undefined,
    completedRuntimeNodeIds: ReadonlySet<string>,
): boolean {
    let anyRunning = false;
    for (const node of nodes) {
        const childRunning = applyRunningState(node.children, runningNodeIds, completedRuntimeNodeIds);
        const selfRunning = Boolean(runningNodeIds?.has(node.id)) && !completedRuntimeNodeIds.has(node.id);
        node.running = selfRunning || childRunning;
        anyRunning = anyRunning || Boolean(node.running);
    }
    return anyRunning;
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
    sourceAnnotations?: SourceAnnotation[];
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
        sourceAnnotations: [...(args.sourceAnnotations ?? [])],
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

function organizeChildren(
    node: CustomTestNode,
    sortMode: CustomSortMode = 'location',
    sortDirection: CustomSortDirection = 'asc',
): void {
    const indexed = node.children.map((child, index) => ({ child, index }));
    indexed.sort((a, b) => {
        const groupDelta = childGroup(a.child) - childGroup(b.child);
        if (groupDelta !== 0) {
            return groupDelta;
        }
        const nameDelta = compareSiblingNodes(a.child, b.child, sortMode, sortDirection);
        if (nameDelta !== 0) {
            return nameDelta;
        }
        return a.index - b.index;
    });
    node.children = indexed.map((entry) => entry.child);
    for (const child of node.children) {
        organizeChildren(child, sortMode, sortDirection);
    }
}

function childGroup(node: CustomTestNode): number {
    if (node.kind === 'module' || node.kind === 'package' || node.kind === 'class') {
        return 0;
    }
    return 1;
}

function compareSiblingNodes(
    a: CustomTestNode,
    b: CustomTestNode,
    sortMode: CustomSortMode,
    sortDirection: CustomSortDirection,
): number {
    if (sortMode === 'name') {
        const nameDelta = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
        if (nameDelta !== 0) {
            return sortDirection === 'asc' ? nameDelta : -nameDelta;
        }
    } else if (sortMode === 'status') {
        const statusDelta = directionalDelta(
            statusSortRank(a.status),
            statusSortRank(b.status),
            sortDirection,
        );
        if (statusDelta !== 0) {
            return statusDelta;
        }
    } else if (sortMode === 'duration') {
        const durationDelta = directionalDelta(nodeDuration(a), nodeDuration(b), sortDirection);
        if (durationDelta !== 0) {
            return durationDelta;
        }
    }
    if (a.kind === 'method' && b.kind === 'method' && a.line !== undefined && b.line !== undefined) {
        const lineDelta = a.line - b.line;
        return sortMode === 'location' && sortDirection === 'desc' ? -lineDelta : lineDelta;
    }
    if (a.kind !== 'method' && b.kind !== 'method') {
        const labelDelta = nodeSortKey(a).localeCompare(nodeSortKey(b));
        return sortMode === 'location' && sortDirection === 'desc' ? -labelDelta : labelDelta;
    }
    return 0;
}

function directionalDelta(a: number, b: number, direction: CustomSortDirection): number {
    return direction === 'asc' ? a - b : b - a;
}

function statusSortRank(status: CustomNodeStatus): number {
    if (status === 'error') { return 4; }
    if (status === 'failed') { return 3; }
    if (status === 'skipped') { return 2; }
    if (status === 'passed') { return 1; }
    return 0;
}

function nodeDuration(node: CustomTestNode): number {
    if (typeof node.durationMs === 'number') {
        return node.durationMs;
    }
    return node.children.reduce((total, child) => total + nodeDuration(child), 0);
}

function nodeSortKey(node: CustomTestNode): string {
    return (node.fqcn ?? node.packageName ?? node.className ?? node.label).toLocaleLowerCase();
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
    aliases.add('executed');
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

function uniqueSourceAnnotations(values: readonly SourceAnnotation[]): SourceAnnotation[] {
    const seen = new Set<string>();
    return values.filter((annotation) => {
        const key = `${annotation.name}\0${annotation.value}`;
        if (seen.has(key)) { return false; }
        seen.add(key);
        return true;
    });
}

function formatSourceAnnotation(annotation: SourceAnnotation): string {
    return `@${annotation.name}("${annotation.value}")`;
}

function matchesAnnotationFilter(annotations: readonly SourceAnnotation[], expression: string): boolean {
    const equalsIndex = expression.indexOf('=');
    const name = (equalsIndex >= 0 ? expression.substring(0, equalsIndex) : expression).trim();
    const rawValue = equalsIndex >= 0 ? expression.substring(equalsIndex + 1).trim() : undefined;
    return annotations.some((annotation) => {
        if (annotation.name.toLocaleLowerCase() !== name) {
            return false;
        }
        if (rawValue === undefined || rawValue.length === 0) {
            return true;
        }
        const exact = rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"');
        const expected = (exact ? rawValue.substring(1, rawValue.length - 1) : rawValue).toLocaleLowerCase();
        const actual = annotation.value.toLocaleLowerCase();
        return exact ? actual === expected : actual.includes(expected);
    });
}
