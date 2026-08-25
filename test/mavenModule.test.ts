import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import {
    buildReactorGroups,
    dedupeMavenModules,
    findDeepestModuleForPath,
    MavenModule,
    moduleItemId,
    moduleKeyForDir,
    parseMavenPom,
    resolveModuleForResult,
} from '../src/mavenModule';

function moduleAt(
    moduleDir: string,
    artifactId: string,
    declaredModuleDirs: readonly string[] = [],
): MavenModule {
    return {
        key: moduleKeyForDir(moduleDir),
        moduleDir,
        pomPath: path.join(moduleDir, 'pom.xml'),
        artifactId,
        declaredModuleDirs,
    };
}

test('parses a single or repeated Maven modules element', () => {
    const descriptor = parseMavenPom(`
        <project>
          <artifactId>reactor</artifactId>
          <modules><module>api</module><module>impl/pom.xml</module></modules>
        </project>
    `);
    assert.equal(descriptor.artifactId, 'reactor');
    assert.deepEqual(descriptor.modules, ['api', 'impl/pom.xml']);
});

test('groups a nested Maven reactor into one top-level execution', () => {
    const rootDir = path.resolve('fixture/reactor');
    const apiDir = path.join(rootDir, 'api');
    const implDir = path.join(rootDir, 'impl');
    const nestedDir = path.join(implDir, 'nested');
    const root = moduleAt(rootDir, 'root', [apiDir, implDir]);
    const api = moduleAt(apiDir, 'api');
    const impl = moduleAt(implDir, 'impl', [nestedDir]);
    const nested = moduleAt(nestedDir, 'nested');

    const groups = buildReactorGroups([nested, api, root, impl]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].executionModule.key, root.key);
    assert.deepEqual(new Set(groups[0].scopeModules.map((module) => module.key)), new Set([
        root.key, api.key, impl.key, nested.key,
    ]));
});

test('keeps standalone POMs as separate executions', () => {
    const first = moduleAt(path.resolve('fixture/one'), 'same-artifact');
    const second = moduleAt(path.resolve('fixture/two'), 'same-artifact');

    const groups = buildReactorGroups([first, second]);

    assert.equal(groups.length, 2);
    assert.notEqual(moduleItemId(first), moduleItemId(second));
});

test('deduplicates modules discovered through overlapping workspace roots', () => {
    const original = moduleAt(path.resolve('fixture/project'), 'project');
    const duplicate = { ...original };
    assert.deepEqual(dedupeMavenModules([original, duplicate]), [original]);
});

test('assigns a child report to the deepest containing module', () => {
    const rootDir = path.resolve('fixture/reactor');
    const childDir = path.join(rootDir, 'child');
    const root = moduleAt(rootDir, 'root', [childDir]);
    const child = moduleAt(childDir, 'child');
    const report = path.join(childDir, 'target', 'surefire-reports', 'TEST-example.xml');

    assert.equal(findDeepestModuleForPath([root, child], report)?.key, child.key);
    assert.equal(findDeepestModuleForPath([root], path.resolve('outside/TEST-example.xml')), undefined);
    assert.equal(
        findDeepestModuleForPath([root, child], path.join(childDir, 'src/test/java/DuplicateTest.java'))?.key,
        child.key,
    );
});

test('uses an FQCN fallback only when it identifies one module', () => {
    const first = moduleAt(path.resolve('fixture/one'), 'duplicate');
    const second = moduleAt(path.resolve('fixture/two'), 'duplicate');
    const outsideReport = path.resolve('outside/TEST-example.xml');

    assert.equal(resolveModuleForResult([first, second], outsideReport, [second.key])?.key, second.key);
    assert.equal(resolveModuleForResult([first, second], outsideReport, [first.key, second.key]), undefined);
});
