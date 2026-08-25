import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomTestNode, CustomNodeKind } from '../src/customTestModel';
import { fullPathForNode } from '../src/sourceReference';

function node(kind: CustomNodeKind, overrides: Partial<CustomTestNode> = {}): CustomTestNode {
    return {
        id: kind,
        kind,
        label: kind,
        children: [],
        moduleId: 'module:test',
        moduleDir: 'C:\\workspace',
        tags: [],
        annotations: [],
        sourceAnnotations: [],
        status: 'unknown',
        stats: { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 },
        ...overrides,
    };
}

test('copies a method source path with a line anchor', () => {
    const method = node('method', {
        sourcePath: 'C:\\workspace\\src\\test\\java\\com\\example\\AppTest.java',
        fqcn: 'com.example.AppTest',
        methodName: 'wrongGreet',
        line: 67,
    });

    assert.equal(
        fullPathForNode(method),
        'com.example.AppTest#wrongGreet() — C:\\workspace\\src\\test\\java\\com\\example\\AppTest.java:67',
    );
});

test('keeps a class source path unanchored', () => {
    const testClass = node('class', {
        sourcePath: 'C:\\workspace\\src\\test\\java\\com\\example\\AppTest.java',
        line: 12,
    });

    assert.equal(
        fullPathForNode(testClass),
        'C:\\workspace\\src\\test\\java\\com\\example\\AppTest.java',
    );
});

test('keeps the method selector when no valid source line is available', () => {
    const method = node('virtualMethod', {
        sourcePath: 'C:\\workspace\\src\\test\\java\\com\\example\\AppTest.java',
        fqcn: 'com.example.AppTest',
        methodName: 'dynamicTest',
    });

    assert.equal(
        fullPathForNode(method),
        'com.example.AppTest#dynamicTest() — C:\\workspace\\src\\test\\java\\com\\example\\AppTest.java',
    );
});
