import * as vscode from 'vscode';
import * as fs from 'fs';
import { MavenModule } from './mavenProjectDetector';
import { TestClassInfo, MethodInfo, buildFqcn } from './javaTestScanner';
import { SuiteResult } from './surefireParser';
import { readSettings } from './settings';

const RESULT_STATUS_NAMES = ['passed', 'failed', 'error', 'skipped'] as const;
const RESULT_STATUS_TAGS = new Set(RESULT_STATUS_NAMES.map(statusTagId));

/**
 * Builds and maintains the VS Code TestItem hierarchy.
 *
 * Tree shape:
 *   Module → Package → OuterClass → [@Nested InnerClass →]* Method
 *
 * @Nested classes are represented as children of their parent class item, mirroring
 * the JUnit 5 nesting structure.  Surefire reports nested class results with the
 * $ separator (e.g. "AppTest$WhenNameIsSimple") — the same format used here as IDs.
 *
 * TestItem ID conventions:
 *   Module:        {artifactId}
 *   Package:       {artifactId}/{packageName}
 *   Class:         {artifactId}/{packageName}/{ClassName}          (may include $)
 *   Method:        {artifactId}/{packageName}/{ClassName}#{method}
 */
export class TestTreeBuilder {
    private readonly controller: vscode.TestController;

    // FQCN (com.example.AppTest$Nested) → TestItem — used by resultPublisher
    private readonly classItems = new Map<string, vscode.TestItem>();
    // "FQCN#methodName" → TestItem
    private readonly methodItems = new Map<string, vscode.TestItem>();
    // "moduleId/packageName" → TestItem
    private readonly packageItems = new Map<string, vscode.TestItem>();
    // "moduleId" → TestItem
    private readonly moduleItems = new Map<string, vscode.TestItem>();

    constructor(controller: vscode.TestController) {
        this.controller = controller;
    }

    buildTree(modulesWithClasses: ReadonlyArray<{ module: MavenModule; classes: readonly TestClassInfo[] }>): void {
        this.classItems.clear();
        this.methodItems.clear();
        this.packageItems.clear();
        this.moduleItems.clear();

        const moduleItems: vscode.TestItem[] = [];
        for (const { module, classes } of modulesWithClasses) {
            moduleItems.push(this.buildModuleItem(module, classes));
        }
        this.controller.items.replace(moduleItems);
    }

    findClassItem(fqcn: string): vscode.TestItem | undefined {
        return this.classItems.get(fqcn);
    }

    findMethodItem(fqcn: string, methodName: string): vscode.TestItem | undefined {
        return this.methodItems.get(`${fqcn}#${methodName}`);
    }

    getModuleItems(): vscode.TestItem[] {
        const items: vscode.TestItem[] = [];
        this.controller.items.forEach((item) => items.push(item));
        return items;
    }

    getAllClassItems(): vscode.TestItem[] {
        return Array.from(this.classItems.values());
    }

    getAllMethodItems(): vscode.TestItem[] {
        return Array.from(this.methodItems.values());
    }

    /** Returns all method-level TestItems belonging to a specific module. */
    getMethodItemsForModule(artifactId: string): vscode.TestItem[] {
        const prefix = `${artifactId}/`;
        return Array.from(this.methodItems.values())
            .filter((item) => item.id.startsWith(prefix));
    }

    /** Returns all FQCNs (root classes only) belonging to a package. */
    getFqcnsForPackage(artifactId: string, packageName: string): string[] {
        const pkgKey = `${artifactId}/${packageName}`;
        const pkgItem = this.packageItems.get(pkgKey);
        if (!pkgItem) { return []; }
        const fqcns: string[] = [];
        pkgItem.children.forEach((classItem) => {
            // Find FQCN by reverse-lookup in classItems
            for (const [fqcn, item] of this.classItems) {
                if (item === classItem) { fqcns.push(fqcn); break; }
            }
        });
        return fqcns;
    }

    /**
     * Returns an existing method TestItem or creates a new one dynamically under
     * the class item. Used for inherited and @TestFactory dynamic tests that are
     * not present in the static source scan.
     */
    getOrCreateMethodItem(fqcn: string, methodName: string): vscode.TestItem | undefined {
        const existing = this.methodItems.get(`${fqcn}#${methodName}`);
        if (existing) {
            return existing;
        }
        let classItem = this.classItems.get(fqcn);
        if (!classItem) {
            classItem = this.createDynamicClassItem(fqcn);
        }
        if (!classItem) {
            return undefined;
        }
        const methodId = `${classItem.id}#${methodName}`;
        // Lifecycle annotations (e.g. @BeforeAll) start with '@' — omit '()' suffix.
        const methodLabel = methodName.startsWith('@')
            ? `$(symbol-event) ${methodName}`
            : `$(symbol-method) ${methodName}()`;
        const methodItem = this.controller.createTestItem(methodId, methodLabel, classItem.uri);
        // For lifecycle entries, find the annotation in the source file and set range
        // so the error annotation appears on the correct line in the editor.
        if (methodName.startsWith('@') && classItem.uri) {
            const line = findAnnotationLine(classItem.uri.fsPath, methodName);
            if (line !== undefined) {
                methodItem.range = new vscode.Range(
                    new vscode.Position(line, 0),
                    new vscode.Position(line, 0),
                );
            }
        }
        this.methodItems.set(`${fqcn}#${methodName}`, methodItem);
        // Append to class children
        const children: vscode.TestItem[] = [];
        classItem.children.forEach((c) => children.push(c));
        children.push(methodItem);
        classItem.children.replace(children);
        return methodItem;
    }

    /**
     * Dynamically creates a class TestItem for a FQCN that was not discovered
     * during static source scan (e.g. concrete subclasses, @TestFactory classes).
     * Locates the parent package item by matching the package name portion of the FQCN.
     */
    private createDynamicClassItem(fqcn: string): vscode.TestItem | undefined {
        // Strip nested suffix: "com.example.AppTest$Nested" → "com.example.AppTest"
        const baseFqcn = fqcn.includes('$') ? fqcn.substring(0, fqcn.indexOf('$')) : fqcn;
        const dotIdx = baseFqcn.lastIndexOf('.');
        const packageName = dotIdx >= 0 ? baseFqcn.substring(0, dotIdx) : '';

        // Find a matching package item in the existing tree
        let pkgItem: vscode.TestItem | undefined;
        let moduleId: string | undefined;
        for (const [pkgKey, item] of this.packageItems) {
            const slashIdx = pkgKey.indexOf('/');
            const pkgPart = slashIdx >= 0 ? pkgKey.substring(slashIdx + 1) : pkgKey;
            if (pkgPart === packageName) {
                pkgItem = item;
                moduleId = slashIdx >= 0 ? pkgKey.substring(0, slashIdx) : pkgKey;
                break;
            }
        }
        if (!pkgItem || !moduleId) {
            return undefined;
        }

        // Build class ID using the same convention as buildClassItem
        const classRelative = fqcn.substring(packageName.length > 0 ? packageName.length + 1 : 0);
        const classId = `${moduleId}/${packageName}/${classRelative}`;
        const simpleName = fqcn.includes('$') ? fqcn.split('$').pop()! : baseFqcn.substring(dotIdx + 1);

        const classItem = this.controller.createTestItem(classId, `$(symbol-class) ${simpleName}`);
        this.classItems.set(fqcn, classItem);

        // Append to package children
        const pkgChildren: vscode.TestItem[] = [];
        pkgItem.children.forEach((c) => pkgChildren.push(c));
        pkgChildren.push(classItem);
        pkgItem.children.replace(pkgChildren);

        return classItem;
    }

    /**
     * Resets all test items to a neutral "not yet run" state.
     * Clears aggregate description labels from all tree nodes.
     */
    resetAllResults(): void {
        // Clear aggregate labels
        for (const item of this.classItems.values())   { item.description = ''; }
        for (const item of this.packageItems.values()) { item.description = ''; }
        for (const item of this.moduleItems.values())  { item.description = ''; }
    }
    /**
     * Computes pass/fail/skip aggregate counts and sets the description string on
     * every class, package and module item.  Nested class stats are rolled into
     * their parent class so the outer class always shows the full subtotal.
     * Package / module totals sum only root (non-nested) classes to avoid
     * double-counting.
     */
    updateAggregates(suiteResults: readonly SuiteResult[]): void {
        const settings = readSettings();

        // --- Step 1: direct stats per FQCN from suite results ---
        // Cross-suite dedup: Surefire reports parent-class methods in nested-class
        // XML files, so the same (className, methodName) can appear in multiple suite
        // entries. We count all occurrences WITHIN a suite (needed for @TestFactory /
        // @ParameterizedTest where the same methodName repeats), but skip any
        // (className, methodName) that was already claimed by a previous suite.
        const directStats = new Map<string, AggStats>();
        const claimedByPreviousSuite = new Set<string>();
        for (const suite of suiteResults) {
            const claimedByThisSuite = new Set<string>();
            for (const tc of suite.testCases) {
                if (tc.synthetic) { continue; }
                const crossSuiteKey = `${tc.className}#${tc.methodName}`;
                if (claimedByPreviousSuite.has(crossSuiteKey)) { continue; }
                claimedByThisSuite.add(crossSuiteKey);
                let s = directStats.get(tc.className);
                if (!s) {
                    s = zeroStats();
                    directStats.set(tc.className, s);
                }
                if      (tc.status === 'passed')  { s.passed++;  }
                else if (tc.status === 'failed')  { s.failed++;  }
                else if (tc.status === 'error')   { s.error++;   }
                else if (tc.status === 'skipped') { s.skipped++; }

                const methodItem = this.methodItems.get(`${tc.className}#${tc.methodName}`);
                if (methodItem) {
                    setResultStatusTags(methodItem, statusesFor(tc.status));
                }
            }
            for (const key of claimedByThisSuite) {
                claimedByPreviousSuite.add(key);
            }
        }

        // --- Step 2: copy into classAgg, then roll nested → parent (deepest first) ---
        const classAgg = new Map<string, AggStats>();
        for (const fqcn of this.classItems.keys()) {
            const d = directStats.get(fqcn);
            classAgg.set(fqcn, d ? { ...d } : zeroStats());
        }

        const sortedByDepth = Array.from(this.classItems.keys()).sort(
            (a, b) => b.split('$').length - a.split('$').length,
        );
        for (const fqcn of sortedByDepth) {
            if (!fqcn.includes('$')) { continue; }
            const parentFqcn = fqcn.substring(0, fqcn.lastIndexOf('$'));
            const parentStats = classAgg.get(parentFqcn);
            if (!parentStats) { continue; }
            addInto(parentStats, classAgg.get(fqcn)!);
        }

        // --- Step 3: apply description to class items ---
        for (const [fqcn, classItem] of this.classItems) {
            setResultStatusTags(classItem, statusesForStats(classAgg.get(fqcn)!));
        }

        if (!settings.showStats) {
            return;
        }
        const statsFormat = settings.statsFormat;

        // --- Step 3b: apply description to class items ---
        for (const [fqcn, classItem] of this.classItems) {
            classItem.description = formatStats(classAgg.get(fqcn)!, statsFormat);
        }

        // --- Step 4: aggregate package / module (root classes only — no double-counting) ---
        const pkgAccum = new Map<string, AggStats>();
        const modAccum = new Map<string, AggStats>();

        for (const [fqcn, classItem] of this.classItems) {
            if (fqcn.includes('$')) { continue; }
            const stats = classAgg.get(fqcn)!;
            const parts = classItem.id.split('/');
            if (parts.length < 2) { continue; }
            accumulate(pkgAccum, `${parts[0]}/${parts[1]}`, stats);
            accumulate(modAccum, parts[0], stats);
        }

        for (const [pkgKey, stats] of pkgAccum) {
            const item = this.packageItems.get(pkgKey);
            if (item) { item.description = formatStats(stats, statsFormat); }
        }
        for (const [modKey, stats] of modAccum) {
            const item = this.moduleItems.get(modKey);
            if (item) { item.description = formatStats(stats, statsFormat); }
        }
    }

    // -------------------------------------------------------------------------

    private buildModuleItem(module: MavenModule, classes: readonly TestClassInfo[]): vscode.TestItem {
        const moduleItem = this.controller.createTestItem(module.artifactId, module.artifactId);
        this.moduleItems.set(module.artifactId, moduleItem);

        const byPackage = groupByPackage(classes);
        const packageItems: vscode.TestItem[] = [];
        for (const [packageName, packageClasses] of byPackage) {
            packageItems.push(this.buildPackageItem(module.artifactId, packageName, packageClasses));
        }
        moduleItem.children.replace(packageItems);
        return moduleItem;
    }

    private buildPackageItem(
        moduleId: string,
        packageName: string,
        classes: readonly TestClassInfo[],
    ): vscode.TestItem {
        const pkgId = `${moduleId}/${packageName}`;
        const pkgItem = this.controller.createTestItem(pkgId, packageName ? `$(symbol-namespace) ${packageName}` : '(default package)');
        this.packageItems.set(pkgId, pkgItem);

        // --- Pass 1: create a TestItem for every class (root and nested) ---
        const classItemByName = new Map<string, vscode.TestItem>();
        for (const cls of classes) {
            const classId = `${moduleId}/${packageName}/${cls.className}`;
            const classUri = vscode.Uri.file(cls.filePath);

            // Display label uses the simple name after the last $
            const simpleName = cls.className.includes('$')
                ? cls.className.split('$').pop()!
                : cls.className;

            const classItem = this.controller.createTestItem(
                classId,
                cls.displayName ? `$(symbol-class) ${cls.displayName}` : `$(symbol-class) ${simpleName}`,
                classUri,
            );
            classItem.tags = [
                ...cls.tags.map((t) => new vscode.TestTag(t)),
            ];

            const fqcn = buildFqcn(packageName, cls.className);
            this.classItems.set(fqcn, classItem);
            classItemByName.set(cls.className, classItem);
        }

        // --- Pass 2: build method items and attach them to their class item ---
        for (const cls of classes) {
            const classItem = classItemByName.get(cls.className)!;
            const classId = `${moduleId}/${packageName}/${cls.className}`;
            const fqcn = buildFqcn(packageName, cls.className);

            const methodItems = cls.methods.map((method) =>
                this.buildMethodItem(classId, classItem.uri, fqcn, method, cls.tags),
            );
            classItem.children.replace(methodItems);
        }

        // --- Pass 3: nest each nested class (contains $) under its parent class item ---
        // Sort by nesting depth so shallower parents are processed before deep children
        const sortedNested = classes
            .filter((cls) => cls.className.includes('$'))
            .sort((a, b) => a.className.split('$').length - b.className.split('$').length);

        for (const cls of sortedNested) {
            const parts = cls.className.split('$');
            const parentName = parts.slice(0, -1).join('$');
            const parentItem = classItemByName.get(parentName);
            const nestedItem = classItemByName.get(cls.className);
            if (!parentItem || !nestedItem) {
                continue;
            }
            // Append nested class item after the parent's existing children (direct methods)
            const existing: vscode.TestItem[] = [];
            parentItem.children.forEach((child) => existing.push(child));
            existing.push(nestedItem);
            parentItem.children.replace(existing);
        }

        // Package children = only root (non-nested) classes
        const rootItems = classes
            .filter((cls) => !cls.className.includes('$'))
            .map((cls) => classItemByName.get(cls.className)!);

        pkgItem.children.replace(rootItems);
        return pkgItem;
    }

    private buildMethodItem(
        classId: string,
        classUri: vscode.Uri | undefined,
        fqcn: string,
        method: MethodInfo,
        classTags: readonly string[] = [],
    ): vscode.TestItem {
        const methodId = `${classId}#${method.name}`;
        const methodItem = this.controller.createTestItem(
            methodId,
            method.displayName ? `$(symbol-method) ${method.displayName}` : `$(symbol-method) ${method.name}()`,
            method.sourcePath ? vscode.Uri.file(method.sourcePath) : classUri,
        );
        methodItem.tags = [
            ...new Set([...classTags, ...method.tags]).values(),
        ].map((t) => typeof t === 'string' ? new vscode.TestTag(t) : t);
        const zeroBasedLine = Math.max(0, method.line - 1);
        methodItem.range = new vscode.Range(
            new vscode.Position(zeroBasedLine, 0),
            new vscode.Position(zeroBasedLine, 0),
        );
        this.methodItems.set(`${fqcn}#${method.name}`, methodItem);
        return methodItem;
    }
}

// -------------------------------------------------------------------------

/**
 * Scans a Java source file for a lifecycle annotation (e.g. "@BeforeAll") and
 * returns the 0-based line index of the annotation, or undefined if not found.
 */
function findAnnotationLine(filePath: string, annotationName: string): number | undefined {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        return undefined;
    }
    const tag = annotationName.slice(1); // strip leading '@'
    const pattern = new RegExp(`^\\s*@${tag}\\b`);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
            return i;
        }
    }
    return undefined;
}

// -------------------------------------------------------------------------

function groupByPackage(classes: readonly TestClassInfo[]): Map<string, TestClassInfo[]> {
    const map = new Map<string, TestClassInfo[]>();
    for (const cls of classes) {
        const existing = map.get(cls.packageName);
        if (existing) {
            existing.push(cls);
        } else {
            map.set(cls.packageName, [cls]);
        }
    }
    return map;
}

// -------------------------------------------------------------------------
// Aggregate stats helpers
// -------------------------------------------------------------------------

interface AggStats {
    passed: number;
    failed: number;
    error: number;
    skipped: number;
}

function zeroStats(): AggStats {
    return { passed: 0, failed: 0, error: 0, skipped: 0 };
}

function addInto(target: AggStats, source: AggStats): void {
    target.passed  += source.passed;
    target.failed  += source.failed;
    target.error   += source.error;
    target.skipped += source.skipped;
}

function accumulate(map: Map<string, AggStats>, key: string, stats: AggStats): void {
    let existing = map.get(key);
    if (!existing) {
        existing = zeroStats();
        map.set(key, existing);
    }
    addInto(existing, stats);
}

function setResultStatusTags(item: vscode.TestItem, statuses: readonly string[]): void {
    const existing = item.tags.filter((tag) => !RESULT_STATUS_TAGS.has(tag.id));
    item.tags = [
        ...existing,
        ...statuses.map((status) => new vscode.TestTag(statusTagId(status))),
    ];
}

function statusTagId(status: string): string {
    return `status.${status}`;
}

function statusesFor(status: SuiteResult['testCases'][number]['status']): string[] {
    if (status === 'error') {
        return ['error', 'failed'];
    }
    return [status];
}

function statusesForStats(stats: AggStats): string[] {
    const statuses: string[] = [];
    if (stats.passed > 0) { statuses.push('passed'); }
    if (stats.failed > 0 || stats.error > 0) { statuses.push('failed'); }
    if (stats.error > 0) { statuses.push('error'); }
    if (stats.skipped > 0) { statuses.push('skipped'); }
    return statuses;
}

function formatStats(stats: AggStats, format: string): string {
    const failCount = stats.failed + stats.error;
    const total = stats.passed + failCount + stats.skipped;
    if (total === 0) { return ''; }

    return format
        .replace('{passed}',  String(stats.passed))
        .replace('{failed}',  String(failCount))
        .replace('{error}',   String(stats.error))
        .replace('{skipped}', String(stats.skipped))
        .replace('{total}',   String(total));
}
