import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

const POM_PARSER = new XMLParser({ ignoreAttributes: false, trimValues: true });

export interface MavenModule {
    readonly key: string;
    readonly pomPath: string;
    readonly moduleDir: string;
    readonly artifactId: string;
    readonly declaredModuleDirs: readonly string[];
}

export interface MavenReactorGroup {
    readonly executionModule: MavenModule;
    readonly scopeModules: readonly MavenModule[];
}

export interface MavenPomDescriptor {
    readonly artifactId?: string;
    readonly modules: readonly string[];
}

export function parseMavenPom(content: string): MavenPomDescriptor {
    const parsed = POM_PARSER.parse(content) as {
        project?: { artifactId?: unknown; modules?: { module?: unknown } };
    };
    const rawModules = parsed.project?.modules?.module;
    const modules = (Array.isArray(rawModules) ? rawModules : [rawModules])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim());
    return {
        artifactId: typeof parsed.project?.artifactId === 'string'
            ? parsed.project.artifactId
            : undefined,
        modules,
    };
}

export function canonicalModuleDir(moduleDir: string): string {
    const normalized = path.resolve(moduleDir).replace(/\\/g, '/').replace(/\/$/, '');
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

export function moduleKeyForDir(moduleDir: string): string {
    return canonicalModuleDir(moduleDir);
}

export function moduleItemId(module: MavenModule): string {
    return `module:${encodeURIComponent(module.key)}`;
}

export function dedupeMavenModules(modules: readonly MavenModule[]): MavenModule[] {
    const byKey = new Map<string, MavenModule>();
    for (const module of modules) {
        if (!byKey.has(module.key)) {
            byKey.set(module.key, module);
        }
    }
    return Array.from(byKey.values()).sort(compareModules);
}

export function buildReactorGroups(modules: readonly MavenModule[]): MavenReactorGroup[] {
    const uniqueModules = dedupeMavenModules(modules);
    const byDir = new Map(uniqueModules.map((module) => [canonicalModuleDir(module.moduleDir), module]));
    const parentByChild = new Map<string, MavenModule>();

    for (const parent of uniqueModules) {
        for (const declaredDir of parent.declaredModuleDirs) {
            const child = byDir.get(canonicalModuleDir(declaredDir));
            if (!child || child.key === parent.key) {
                continue;
            }
            const currentParent = parentByChild.get(child.key);
            if (!currentParent || parent.moduleDir.length > currentParent.moduleDir.length) {
                parentByChild.set(child.key, parent);
            }
        }
    }

    const rootFor = (module: MavenModule): MavenModule => {
        let current = module;
        const visited = new Set<string>();
        while (!visited.has(current.key)) {
            visited.add(current.key);
            const parent = parentByChild.get(current.key);
            if (!parent) {
                return current;
            }
            current = parent;
        }
        return Array.from(visited)
            .map((key) => uniqueModules.find((candidate) => candidate.key === key)!)
            .sort(compareModules)[0];
    };

    const groups = new Map<string, MavenModule[]>();
    for (const module of uniqueModules) {
        const root = rootFor(module);
        const scope = groups.get(root.key) ?? [];
        scope.push(module);
        groups.set(root.key, scope);
    }

    return Array.from(groups.entries())
        .map(([rootKey, scopeModules]) => ({
            executionModule: uniqueModules.find((module) => module.key === rootKey)!,
            scopeModules: scopeModules.sort(compareModules),
        }))
        .sort((left, right) => compareModules(left.executionModule, right.executionModule));
}

export function findDeepestModuleForPath(
    modules: readonly MavenModule[],
    candidatePath: string,
): MavenModule | undefined {
    const resolvedCandidate = path.resolve(candidatePath);
    return modules
        .filter((module) => isPathInside(module.moduleDir, resolvedCandidate))
        .sort((left, right) => right.moduleDir.length - left.moduleDir.length)[0];
}

export function resolveModuleForResult(
    modules: readonly MavenModule[],
    xmlPath: string,
    fallbackModuleKeys: readonly string[],
): MavenModule | undefined {
    const pathModule = findDeepestModuleForPath(modules, xmlPath);
    if (pathModule) {
        return pathModule;
    }
    const uniqueKeys = Array.from(new Set(fallbackModuleKeys));
    return uniqueKeys.length === 1
        ? modules.find((module) => module.key === uniqueKeys[0])
        : undefined;
}

export function isPathInside(parentDir: string, candidatePath: string): boolean {
    const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
    return relative === ''
        || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function compareModules(left: MavenModule, right: MavenModule): number {
    const depthDelta = path.resolve(left.moduleDir).split(path.sep).length
        - path.resolve(right.moduleDir).split(path.sep).length;
    return depthDelta !== 0 ? depthDelta : left.key.localeCompare(right.key);
}
