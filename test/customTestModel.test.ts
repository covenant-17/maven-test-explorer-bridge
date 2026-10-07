import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCustomTree } from '../src/customTestModel';
import type { TestClassInfo } from '../src/javaTestScanner';
import type { MavenModule } from '../src/mavenModule';
import type { SuiteResult, TestCaseResult } from '../src/surefireParser';

const moduleInfo: MavenModule = {
    key: 'C:/workspace',
    pomPath: 'C:/workspace/pom.xml',
    moduleDir: 'C:/workspace',
    artifactId: 'example',
    declaredModuleDirs: [],
    availableProfiles: [],
    profileDescriptions: {},
    profileSourceLines: {},
};

const testClass: TestClassInfo = {
    filePath: 'C:/workspace/src/test/java/com/example/ParameterizedExampleTest.java',
    packageName: 'com.example',
    className: 'ParameterizedExampleTest',
    line: 10,
    isInterface: false,
    isAbstract: false,
    extendedTypes: [],
    implementedTypes: [],
    displayName: undefined,
    tags: [],
    annotations: [],
    methods: [{
        name: 'acceptsValue',
        displayName: undefined,
        line: 20,
        tags: [],
        annotations: [],
    }],
};

const result = (methodName: string, status: TestCaseResult['status'], durationMs: number): TestCaseResult => ({
    className: 'com.example.ParameterizedExampleTest',
    methodName,
    status,
    durationMs,
    failureMessage: undefined,
    failureType: undefined,
    stackTrace: undefined,
    systemOut: undefined,
    systemErr: undefined,
});

test('nests parameterized invocations under their source method', () => {
    const suite: SuiteResult = {
        suiteName: 'com.example.ParameterizedExampleTest',
        xmlPath: 'C:/workspace/target/surefire-reports/TEST-com.example.ParameterizedExampleTest.xml',
        testCases: [
            result('acceptsValue(String)[1]', 'passed', 18),
            result('acceptsValue(String)[2]', 'failed', 1),
            result('acceptsValue(String)[3]', 'passed', 1),
        ],
    };

    const tree = buildCustomTree([{ module: moduleInfo, classes: [testClass] }], [suite], undefined);
    const classNode = tree.roots[0]?.children[0]?.children[0];
    const methodNode = classNode?.children.find((node) => node.methodName === 'acceptsValue');

    assert.ok(methodNode);
    assert.equal(methodNode.hasVirtualInvocations, true);
    assert.deepEqual(methodNode.children.map((node) => node.methodName), [
        'acceptsValue(String)[1]',
        'acceptsValue(String)[2]',
        'acceptsValue(String)[3]',
    ]);
    assert.ok(methodNode.children.every((node) => node.parentId === methodNode.id));
    assert.equal(classNode?.children.length, 1);
    assert.deepEqual(methodNode.stats, { passed: 2, failed: 1, error: 0, skipped: 0, total: 3 });
    assert.equal(methodNode.status, 'failed');
});
