export function filterTree<T>(
    nodes: readonly T[],
    childrenOf: (node: T) => readonly T[],
    matches: (node: T) => boolean,
    cloneWithChildren: (node: T, children: readonly T[]) => T,
): T[] {
    const filtered: T[] = [];
    for (const node of nodes) {
        const childMatches = filterTree(childrenOf(node), childrenOf, matches, cloneWithChildren);
        if (matches(node) || childMatches.length > 0) {
            filtered.push(cloneWithChildren(node, childMatches));
        }
    }
    return filtered;
}
