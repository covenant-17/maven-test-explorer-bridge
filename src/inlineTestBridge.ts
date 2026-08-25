import * as vscode from 'vscode';
import * as fs from 'fs';
import { MavenModule } from './mavenProjectDetector';
import { moduleItemId, resolveModuleForResult } from './mavenModule';
import { TestClassInfo, MethodInfo, buildFqcn } from './javaTestScanner';

/**
 * Maintains the minimal VS Code TestItem hierarchy required for editor gutter
 * actions, running indicators, result messages, and error peek. The dedicated
 * custom webview remains the extension's user-facing test explorer.
 *
 * Tree shape:
 *   Module → Package → OuterClass → [@Nested InnerClass →]* Method
 *
 * @Nested classes are represented as children of their parent class item, mirroring
 * the JUnit 5 nesting structure.  Surefire reports nested class results with the
 * $ separator (e.g. "AppTest$WhenNameIsSimple") — the same format used here as IDs.
 *
 * TestItem ID conventions:
 *   Module:        module:{encoded canonical module directory}
 *   Package:       {moduleId}/{packageName}
 *   Class:         {moduleId}/{packageName}/{ClassName}          (may include $)
 *   Method:        {moduleId}/{packageName}/{ClassName}#{method}
 */
export class InlineTestBridge {
    private readonly controller: vscode.TestController;

    // "moduleKey\0FQCN" → TestItem — used by resultPublisher
    private readonly classItems = new Map<string, vscode.TestItem>();
    // "moduleKey\0FQCN#methodName" → TestItem
    private readonly methodItems = new Map<string, vscode.TestItem>();
    // "moduleId/packageName" → TestItem
    private readonly packageItems = new Map<string, vscode.TestItem>();
    private modules: MavenModule[] = [];
    constructor(controller: vscode.TestController) {
        this.controller = controller;
    }

    buildTree(modulesWithClasses: ReadonlyArray<{ module: MavenModule; classes: readonly TestClassInfo[] }>): void {
        this.classItems.clear();
        this.methodItems.clear();
        this.packageItems.clear();
        this.modules = modulesWithClasses.map(({ module }) => module);

        const moduleItems: vscode.TestItem[] = [];
        for (const { module, classes } of modulesWithClasses) {
            moduleItems.push(this.buildModuleItem(module, classes));
        }
        this.controller.items.replace(moduleItems);
    }

    resolveModuleKey(xmlPath: string, fqcn: string): string | undefined {
        const matches = this.modules.filter((module) => this.classItems.has(classMapKey(module.key, fqcn)));
        return resolveModuleForResult(this.modules, xmlPath, matches.map((module) => module.key))?.key;
    }

    findClassItem(moduleKey: string, fqcn: string): vscode.TestItem | undefined {
        return this.classItems.get(classMapKey(moduleKey, fqcn));
    }

    findMethodItem(moduleKey: string, fqcn: string, methodName: string): vscode.TestItem | undefined {
        return this.methodItems.get(methodMapKey(moduleKey, fqcn, methodName));
    }

    /**
     * Returns an existing method TestItem or creates a new one dynamically under
     * the class item. Used for inherited and @TestFactory dynamic tests that are
     * not present in the static source scan.
     */
    getOrCreateMethodItem(moduleKey: string, fqcn: string, methodName: string): vscode.TestItem | undefined {
        const existing = this.methodItems.get(methodMapKey(moduleKey, fqcn, methodName));
        if (existing) {
            return existing;
        }
        let classItem = this.classItems.get(classMapKey(moduleKey, fqcn));
        if (!classItem) {
            classItem = this.createDynamicClassItem(moduleKey, fqcn);
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
        this.methodItems.set(methodMapKey(moduleKey, fqcn, methodName), methodItem);
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
    private createDynamicClassItem(moduleKey: string, fqcn: string): vscode.TestItem | undefined {
        // Strip nested suffix: "com.example.AppTest$Nested" → "com.example.AppTest"
        const baseFqcn = fqcn.includes('$') ? fqcn.substring(0, fqcn.indexOf('$')) : fqcn;
        const dotIdx = baseFqcn.lastIndexOf('.');
        const packageName = dotIdx >= 0 ? baseFqcn.substring(0, dotIdx) : '';

        // Find a matching package item in the existing tree
        let pkgItem: vscode.TestItem | undefined;
        let moduleId: string | undefined;
        const module = this.modules.find((candidate) => candidate.key === moduleKey);
        if (!module) {
            return undefined;
        }
        const expectedModuleId = moduleItemId(module);
        for (const [pkgKey, item] of this.packageItems) {
            const slashIdx = pkgKey.indexOf('/');
            const pkgPart = slashIdx >= 0 ? pkgKey.substring(slashIdx + 1) : pkgKey;
            if (pkgKey.startsWith(`${expectedModuleId}/`) && pkgPart === packageName) {
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
        this.classItems.set(classMapKey(moduleKey, fqcn), classItem);

        // Append to package children
        const pkgChildren: vscode.TestItem[] = [];
        pkgItem.children.forEach((c) => pkgChildren.push(c));
        pkgChildren.push(classItem);
        pkgItem.children.replace(pkgChildren);

        return classItem;
    }

    private buildModuleItem(module: MavenModule, classes: readonly TestClassInfo[]): vscode.TestItem {
        const id = moduleItemId(module);
        const moduleItem = this.controller.createTestItem(id, module.artifactId);
        const byPackage = groupByPackage(classes);
        const packageItems: vscode.TestItem[] = [];
        for (const [packageName, packageClasses] of byPackage) {
            packageItems.push(this.buildPackageItem(module, id, packageName, packageClasses));
        }
        moduleItem.children.replace(packageItems);
        return moduleItem;
    }

    private buildPackageItem(
        module: MavenModule,
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

            const fqcn = buildFqcn(packageName, cls.className);
            this.classItems.set(classMapKey(module.key, fqcn), classItem);
            classItemByName.set(cls.className, classItem);
        }

        // --- Pass 2: build method items and attach them to their class item ---
        for (const cls of classes) {
            const classItem = classItemByName.get(cls.className)!;
            const classId = `${moduleId}/${packageName}/${cls.className}`;
            const fqcn = buildFqcn(packageName, cls.className);

            const methodItems = cls.methods.map((method) =>
                this.buildMethodItem(module.key, classId, classItem.uri, fqcn, method),
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
        moduleKey: string,
        classId: string,
        classUri: vscode.Uri | undefined,
        fqcn: string,
        method: MethodInfo,
    ): vscode.TestItem {
        const methodId = `${classId}#${method.name}`;
        const methodItem = this.controller.createTestItem(
            methodId,
            method.displayName ? `$(symbol-method) ${method.displayName}` : `$(symbol-method) ${method.name}()`,
            method.sourcePath ? vscode.Uri.file(method.sourcePath) : classUri,
        );
        const zeroBasedLine = Math.max(0, method.line - 1);
        methodItem.range = new vscode.Range(
            new vscode.Position(zeroBasedLine, 0),
            new vscode.Position(zeroBasedLine, 0),
        );
        this.methodItems.set(methodMapKey(moduleKey, fqcn, method.name), methodItem);
        return methodItem;
    }
}

function classMapKey(moduleKey: string, fqcn: string): string {
    return `${moduleKey}\0${fqcn}`;
}

function methodMapKey(moduleKey: string, fqcn: string, methodName: string): string {
    return `${classMapKey(moduleKey, fqcn)}#${methodName}`;
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
