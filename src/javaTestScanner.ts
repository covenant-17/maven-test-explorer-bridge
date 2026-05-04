import * as vscode from 'vscode';
import * as fs from 'fs';
import { JAVA_TEST_GLOB } from './constants';

export interface MethodInfo {
    readonly name: string;
    readonly displayName: string | undefined;
    readonly line: number;
}

export interface TestClassInfo {
    readonly filePath: string;
    readonly packageName: string;
    /**
     * Simple or nested class name using $ notation matching Surefire output.
     * Examples: "AppTest", "AppTest$WhenNameIsSimple", "AppTest$WhenCheckingFormat$AndCasing"
     */
    readonly className: string;
    readonly displayName: string | undefined;
    readonly methods: readonly MethodInfo[];
}

/** Internal state per class scope while parsing. */
interface ClassFrame {
    simpleName: string;
    fullName: string;
    openDepth: number;
    displayName: string | undefined;
    methods: MethodInfo[];
    seen: Set<string>;
}

const PACKAGE_PATTERN = /^\s*package\s+([\w.]+)\s*;/m;
const DISPLAY_NAME_PATTERN = /@DisplayName\s*\(\s*"([^"]+)"\s*\)/;
const TEST_ANNOTATION_PATTERN = /@(?:Test|ParameterizedTest|RepeatedTest)\b/;
const NESTED_ANNOTATION_PATTERN = /@Nested\b/;
const CLASS_DECL_PATTERN = /(?:^|\s)class\s+(\w+)/;
const METHOD_DECL_PATTERN = /^(?:(?:public|protected|private)\s+)?(?:static\s+)?(?:final\s+)?void\s+(\w+)\s*\(/;

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

    const results: TestClassInfo[] = [];
    for (const uri of allUris) {
        results.push(...parseJavaTestFile(uri.fsPath));
    }
    return results;
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

    if (!TEST_ANNOTATION_PATTERN.test(content)) {
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

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // Skip single-line comments and javadoc lines — avoids false matches
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
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

        // --- Class declaration (outer class or @Nested) ---
        const classMatch = CLASS_DECL_PATTERN.exec(trimmed);
        if (classMatch && (classStack.length === 0 || pendingNested)) {
            const simpleName = classMatch[1];
            const parentFull = classStack.length > 0 ? classStack[classStack.length - 1].fullName : '';
            const fullName = parentFull ? `${parentFull}$${simpleName}` : simpleName;

            classStack.push({
                simpleName,
                fullName,
                openDepth: braceDepth,
                displayName: pendingDisplayName,
                methods: [],
                seen: new Set(),
            });
            pendingNested = false;
            pendingDisplayName = undefined;
            pendingTestAnnotation = false; // @Test before a class is irrelevant
        }

        // --- Test method declaration ---
        if (pendingTestAnnotation && classStack.length > 0) {
            const methodMatch = METHOD_DECL_PATTERN.exec(trimmed);
            if (methodMatch) {
                const methodName = methodMatch[1];
                const frame = classStack[classStack.length - 1];
                if (!frame.seen.has(methodName)) {
                    frame.seen.add(methodName);
                    frame.methods.push({ name: methodName, displayName: pendingDisplayName, line: i + 1 });
                }
                pendingTestAnnotation = false;
                pendingDisplayName = undefined;
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
                        displayName: frame.displayName,
                        methods: frame.methods,
                    });
                }
            }
        }
    }

    // Flush any frames left unclosed (malformed Java — shouldn't happen in practice)
    while (classStack.length > 0) {
        const frame = classStack.pop()!;
        completed.push({ filePath, packageName, className: frame.fullName, displayName: frame.displayName, methods: frame.methods });
    }

    return completed;
}

/**
 * Builds the fully-qualified class name from package and class name.
 * For nested classes, className already contains $ (e.g. "AppTest$WhenNested"),
 * producing the same FQCN that Surefire reports in XML.
 */
export function buildFqcn(packageName: string, className: string): string {
    return packageName ? `${packageName}.${className}` : className;
}
