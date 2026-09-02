import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTree } from '../src/treeFilter';

interface Node {
    readonly name: string;
    readonly matches: boolean;
    readonly children: readonly Node[];
}

const filter = (nodes: readonly Node[]): Node[] => filterTree(
    nodes,
    (node) => node.children,
    (node) => node.matches,
    (node, children) => ({ ...node, children }),
);

test('a matching container does not retain children that fail the filter', () => {
    const result = filter([{
        name: 'mixed class',
        matches: true,
        children: [
            { name: 'passed method', matches: false, children: [] },
            { name: 'failed method', matches: true, children: [] },
        ],
    }]);

    assert.deepEqual(result.map((node) => ({
        name: node.name,
        children: node.children.map((child) => child.name),
    })), [{ name: 'mixed class', children: ['failed method'] }]);
});

test('non-matching ancestors are retained only as paths to matching descendants', () => {
    const result = filter([{
        name: 'package',
        matches: false,
        children: [{ name: 'failed class', matches: true, children: [] }],
    }]);

    assert.equal(result[0]?.name, 'package');
    assert.deepEqual(result[0]?.children.map((child) => child.name), ['failed class']);
});
