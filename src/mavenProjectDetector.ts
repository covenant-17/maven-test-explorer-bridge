import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { POM_GLOB } from './constants';
import { MavenModule, moduleKeyForDir, parseMavenPom } from './mavenModule';

export { MavenModule } from './mavenModule';

const TARGET_SEGMENT = `${path.sep}target${path.sep}`;

/**
 * Finds all Maven modules in the given workspace folder by locating pom.xml files.
 * Excludes pom.xml files inside target/ directories.
 */
export async function findMavenModules(workspaceFolder: vscode.WorkspaceFolder): Promise<MavenModule[]> {
    const pattern = new vscode.RelativePattern(workspaceFolder, POM_GLOB);
    const uris = await vscode.workspace.findFiles(pattern, '**/target/**');

    const modules: MavenModule[] = [];

    for (const uri of uris) {
        const pomPath = uri.fsPath;

        // Extra safety: skip anything under a target directory
        if (pomPath.includes(TARGET_SEGMENT) || pomPath.includes('/target/')) {
            continue;
        }

        const moduleDir = path.dirname(pomPath);
        const descriptor = extractPomDescriptor(pomPath);
        const artifactId = descriptor.artifactId ?? path.basename(moduleDir);
        const declaredModuleDirs = descriptor.modules.map((modulePath) => {
            const resolved = path.resolve(moduleDir, modulePath);
            return path.basename(resolved).toLocaleLowerCase() === 'pom.xml' ? path.dirname(resolved) : resolved;
        });

        modules.push({
            key: moduleKeyForDir(moduleDir),
            pomPath,
            moduleDir,
            artifactId,
            declaredModuleDirs,
        });
    }

    // Sort: root pom first (shortest path), then alphabetically
    modules.sort((a, b) => {
        const depthA = a.pomPath.split(path.sep).length;
        const depthB = b.pomPath.split(path.sep).length;
        if (depthA !== depthB) {
            return depthA - depthB;
        }
        return a.artifactId.localeCompare(b.artifactId);
    });

    return modules;
}

/**
 * Reads the first <artifactId> element from a pom.xml file.
 * Returns undefined if the file cannot be read or the element is not found.
 */
function extractPomDescriptor(pomPath: string): { artifactId?: string; modules: readonly string[] } {
    try {
        const content = fs.readFileSync(pomPath, 'utf8');
        return parseMavenPom(content);
    } catch {
        return { modules: [] };
    }
}
