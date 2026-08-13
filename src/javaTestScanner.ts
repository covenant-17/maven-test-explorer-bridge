import * as vscode from 'vscode';
import * as fs from 'fs';
import { JAVA_TEST_GLOB } from './constants';

export interface SourceAnnotation {
    readonly name: string;
    readonly value: string;
}

export interface MethodInfo {
    readonly name: string;
    readonly displayName: string | undefined;
    readonly line: number;
    readonly sourcePath?: string;
    readonly inheritedFrom?: string;
    readonly tags: readonly string[];
    readonly annotations: readonly SourceAnnotation[];
}

export interface TestClassInfo {
    readonly filePath: string;
    readonly packageName: string;
    /**
     * Simple or nested class name using $ notation matching Surefire output.
     * Examples: "AppTest", "AppTest$WhenNameIsSimple", "AppTest$WhenCheckingFormat$AndCasing"
     */
    readonly className: string;
    readonly line: number;
    readonly isInterface: boolean;
    readonly implementedTypes: readonly string[];
    readonly displayName: string | undefined;
    readonly tags: readonly string[];
    readonly annotations: readonly SourceAnnotation[];
    readonly methods: readonly MethodInfo[];
}

/** Internal state per class scope while parsing. */
interface ClassFrame {
    simpleName: string;
    fullName: string;
    line: number;
    isInterface: boolean;
    implementedTypes: string[];
    openDepth: number;
    displayName: string | undefined;
    tags: string[];
    annotations: SourceAnnotation[];
    methods: MethodInfo[];
    seen: Set<string>;
}

const PACKAGE_PATTERN = /^\s*package\s+([\w.]+)\s*;/m;
const DISPLAY_NAME_PATTERN = /@DisplayName\s*\(\s*"([^"]+)"\s*\)/;
const TEST_ANNOTATION_PATTERN = /@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b/;
const NESTED_ANNOTATION_PATTERN = /@Nested\b/;
const TAG_ANNOTATION_PATTERN = /@Tag\s*\(\s*"([^"]+)"\s*\)/g;
const STRING_ANNOTATION_PATTERN = /@(\w+)\s*\(\s*(\{[^}]*\}|"[^"]*")\s*\)/g;
const STRING_LITERAL_PATTERN = /"([^"]+)"/g;
const CLASS_DECL_PATTERN = /(?:^|\s)(class|interface)\s+(\w+)/;
const IMPLEMENTS_PATTERN = /\bimplements\s+([^\{]+)/;
// Matches @Test void method(), @TestFactory Stream<X> method(), default void method()
const METHOD_DECL_PATTERN = /^(?:(?:public|protected|private|default)\s+)?(?:static\s+)?(?:final\s+)?(?:void|\w[\w.<>,\s]*)\s+(\w+)\s*\(/;

/**
 * Scans all Java test source files inside the given module directory.
 * Returns one TestClassInfo per class (including @Nested inner classes).
 */
export async function scanTestFiles(
    moduleDir: string,
    globs: readonly string[] = [JAVA_TEST_GLOB],
): Promise<TestClassInfo[]> {
    const seen = new Set<string>();
    const allUris: vscode.Uri[] = [];

    for (const glob of globs) {
        const pattern = new vscode.RelativePattern(moduleDir, glob);
        const found = await vscode.workspace.findFiles(pattern);
        for (const uri of found) {
            if (!seen.has(uri.fsPath)) {
                seen.add(uri.fsPath);
                allUris.push(uri);
            }
        }
    }
    allUris.sort((a, b) => normalizePath(a.fsPath).localeCompare(normalizePath(b.fsPath)));

    const declarations: TestClassInfo[] = [];
    for (const uri of allUris) {
        declarations.push(...parseJavaTestFile(uri.fsPath));
    }
    return resolveTestContracts(declarations);
}

/**
 * Parses a single Java source file and returns one TestClassInfo per class scope,
 * including @Nested inner classes.  Uses brace-depth tracking to detect class boundaries.
 */
function parseJavaTestFile(filePath: string): TestClassInfo[] {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        return [];
    }
    if (!TEST_ANNOTATION_PATTERN.test(content) && !/\bimplements\b/.test(content)) {
        return [];
    }

    const packageMatch = PACKAGE_PATTERN.exec(content);
    const packageName = packageMatch?.[1] ?? '';
    const lines = content.split('\n');

    const completed: TestClassInfo[] = [];
    const classStack: ClassFrame[] = [];

    let braceDepth = 0;
    let pendingNested = false;
    let pendingDisplayName: string | undefined;
    let pendingTestAnnotation = false;
    let pendingTags: string[] = [];
    let pendingAnnotations: SourceAnnotation[] = [];
    let pendingStringAnnotation = '';

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // Skip single-line comments and javadoc lines — avoids false matches
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            continue;
        }

        let annotationSource = trimmed;
        if (pendingStringAnnotation) {
            pendingStringAnnotation += ` ${trimmed}`;
            if (!trimmed.includes(')')) {
                continue;
            }
            annotationSource = pendingStringAnnotation;
            pendingStringAnnotation = '';
        } else if (
            /^@(?!Test\b|ParameterizedTest\b|RepeatedTest\b|TestFactory\b|Nested\b|Tag\b|DisplayName\b)\w+\s*\(/.test(trimmed)
            && !trimmed.includes(')')
        ) {
            pendingStringAnnotation = trimmed;
            continue;
        }

        // --- Annotation detection ---
        if (NESTED_ANNOTATION_PATTERN.test(trimmed)) {
            pendingNested = true;
        }
        const dnMatch = DISPLAY_NAME_PATTERN.exec(trimmed);
        if (dnMatch) {
            pendingDisplayName = dnMatch[1];
        }
        if (TEST_ANNOTATION_PATTERN.test(trimmed)) {
            pendingTestAnnotation = true;
        }
        // Collect @Tag("...") — may appear multiple times on the same line
        TAG_ANNOTATION_PATTERN.lastIndex = 0;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = TAG_ANNOTATION_PATTERN.exec(trimmed)) !== null) {
            pendingTags.push(tagMatch[1]);
        }
        STRING_ANNOTATION_PATTERN.lastIndex = 0;
        let annotationMatch: RegExpExecArray | null;
        while ((annotationMatch = STRING_ANNOTATION_PATTERN.exec(annotationSource)) !== null) {
            if (annotationMatch[1] !== 'Tag' && annotationMatch[1] !== 'DisplayName') {
                STRING_LITERAL_PATTERN.lastIndex = 0;
                let valueMatch: RegExpExecArray | null;
                while ((valueMatch = STRING_LITERAL_PATTERN.exec(annotationMatch[2])) !== null) {
                    pendingAnnotations.push({ name: annotationMatch[1], value: valueMatch[1] });
                }
            }
        }

        // --- Class declaration (outer class or @Nested) ---
        const classMatch = CLASS_DECL_PATTERN.exec(trimmed);
        if (classMatch && (classStack.length === 0 || pendingNested)) {
            const isInterface = classMatch[1] === 'interface';
            const simpleName = classMatch[2];
            const parentFull = classStack.length > 0 ? classStack[classStack.length - 1].fullName : '';
            const fullName = parentFull ? `${parentFull}$${simpleName}` : simpleName;
            const declarationSource = lines
                .slice(i, Math.min(lines.length, i + 8))
                .join(' ')
                .split('{', 1)[0];

            classStack.push({
                simpleName,
                fullName,
                line: i + 1,
                isInterface,
                implementedTypes: parseImplementedTypes(declarationSource),
                openDepth: braceDepth,
                displayName: pendingDisplayName,
                tags: [...pendingTags],
                annotations: [...pendingAnnotations],
                methods: [],
                seen: new Set(),
            });
            pendingNested = false;
            pendingDisplayName = undefined;
            pendingTestAnnotation = false; // @Test before a class is irrelevant
            pendingTags = [];
            pendingAnnotations = [];
        }

        // --- Test method declaration ---
        if (pendingTestAnnotation && classStack.length > 0) {
            const methodMatch = METHOD_DECL_PATTERN.exec(trimmed);
            if (methodMatch) {
                const methodName = methodMatch[1];
                const frame = classStack[classStack.length - 1];
                if (!frame.seen.has(methodName)) {
                    frame.seen.add(methodName);
                    frame.methods.push({
                        name: methodName,
                        displayName: pendingDisplayName,
                        line: i + 1,
                        sourcePath: filePath,
                        tags: [...pendingTags],
                        annotations: [...pendingAnnotations],
                    });
                }
                pendingTestAnnotation = false;
                pendingDisplayName = undefined;
                pendingTags = [];
                pendingAnnotations = [];
            }
        }

        // --- Brace tracking (determines class scope boundaries) ---
        for (const ch of trimmed) {
            if (ch === '{') {
                braceDepth++;
            } else if (ch === '}') {
                braceDepth--;
                if (classStack.length > 0 && braceDepth === classStack[classStack.length - 1].openDepth) {
                    const frame = classStack.pop()!;
                    completed.push({
                        filePath,
                        packageName,
                        className: frame.fullName,
                        line: frame.line,
                        isInterface: frame.isInterface,
                        implementedTypes: frame.implementedTypes,
                        displayName: frame.displayName,
                        tags: frame.tags,
                        annotations: frame.annotations,
                        methods: frame.methods,
                    });
                }
            }
        }
    }

    // Flush any frames left unclosed (malformed Java — shouldn't happen in practice)
    while (classStack.length > 0) {
        const frame = classStack.pop()!;
        completed.push({
            filePath,
            packageName,
            className: frame.fullName,
            line: frame.line,
            isInterface: frame.isInterface,
            implementedTypes: frame.implementedTypes,
            displayName: frame.displayName,
            tags: frame.tags,
            annotations: frame.annotations,
            methods: frame.methods,
        });
    }

    return completed;
}

function parseImplementedTypes(declaration: string): string[] {
    const match = IMPLEMENTS_PATTERN.exec(declaration);
    if (!match) {
        return [];
    }
    return match[1]
        .split(',')
        .map((value) => value.trim().replace(/<.*>/g, ''))
        .filter(Boolean);
}

function resolveTestContracts(declarations: readonly TestClassInfo[]): TestClassInfo[] {
    const contracts = declarations.filter((item) => item.isInterface && item.methods.length > 0);
    const contractsByFqcn = new Map(contracts.map((item) => [buildFqcn(item.packageName, item.className), item]));
    const contractsBySimpleName = new Map<string, TestClassInfo[]>();
    for (const contract of contracts) {
        const simpleName = contract.className.split('$').pop()!;
        const matches = contractsBySimpleName.get(simpleName) ?? [];
        matches.push(contract);
        contractsBySimpleName.set(simpleName, matches);
    }

    const resolved = declarations
        .filter((item) => !item.isInterface)
        .map((item) => inheritContractMethods(item, contractsByFqcn, contractsBySimpleName));
    const includedNames = new Set(resolved
        .filter((item) => item.methods.length > 0)
        .map((item) => buildFqcn(item.packageName, item.className)));

    // Keep empty outer containers when their @Nested descendants contain tests.
    for (const item of resolved) {
        const fqcn = buildFqcn(item.packageName, item.className);
        if (Array.from(includedNames).some((included) => included.startsWith(`${fqcn}$`))) {
            includedNames.add(fqcn);
        }
    }
    return resolved.filter((item) => includedNames.has(buildFqcn(item.packageName, item.className)));
}

function inheritContractMethods(
    cls: TestClassInfo,
    contractsByFqcn: ReadonlyMap<string, TestClassInfo>,
    contractsBySimpleName: ReadonlyMap<string, readonly TestClassInfo[]>,
): TestClassInfo {
    const methods = [...cls.methods];
    const methodNames = new Set(methods.map((method) => method.name));
    for (const implementedType of cls.implementedTypes) {
        const normalizedType = implementedType.replace(/\s/g, '');
        const samePackageName = normalizedType.includes('.')
            ? normalizedType
            : (cls.packageName ? `${cls.packageName}.${normalizedType}` : normalizedType);
        const simpleName = normalizedType.substring(normalizedType.lastIndexOf('.') + 1);
        const contract = contractsByFqcn.get(samePackageName)
            ?? contractsByFqcn.get(normalizedType)
            ?? contractsBySimpleName.get(simpleName)?.[0];
        if (!contract) {
            continue;
        }
        for (const method of contract.methods) {
            if (methodNames.has(method.name)) {
                continue;
            }
            methodNames.add(method.name);
            methods.push({
                ...method,
                sourcePath: method.sourcePath ?? contract.filePath,
                inheritedFrom: buildFqcn(contract.packageName, contract.className),
                tags: Array.from(new Set([...contract.tags, ...method.tags])),
                annotations: uniqueAnnotations([...contract.annotations, ...method.annotations]),
            });
        }
    }
    return methods.length === cls.methods.length ? cls : { ...cls, methods };
}

function uniqueAnnotations(annotations: readonly SourceAnnotation[]): SourceAnnotation[] {
    const seen = new Set<string>();
    return annotations.filter((annotation) => {
        const key = `${annotation.name}\u0000${annotation.value}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * Builds the fully-qualified class name from package and class name.
 * For nested classes, className already contains $ (e.g. "AppTest$WhenNested"),
 * producing the same FQCN that Surefire reports in XML.
 */
export function buildFqcn(packageName: string, className: string): string {
    return packageName ? `${packageName}.${className}` : className;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLocaleLowerCase();
}
