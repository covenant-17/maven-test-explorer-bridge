import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { POM_GLOB } from './constants';

export interface MavenModule {
    readonly pomPath: string;
    readonly moduleDir: string;
    readonly artifactId: string;
}

const ARTIFACT_ID_PATTERN = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/;
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
        const artifactId = extractArtifactId(pomPath) ?? path.basename(moduleDir);

        modules.push({ pomPath, moduleDir, artifactId });
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
function extractArtifactId(pomPath: string): string | undefined {
    try {
        const content = fs.readFileSync(pomPath, 'utf8');
        const match = ARTIFACT_ID_PATTERN.exec(content);
        return match?.[1];
    } catch {
        return undefined;
    }
}
