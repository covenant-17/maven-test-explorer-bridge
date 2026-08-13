export type TestRowPart = 'expander' | 'status' | 'kindIcon' | 'name' | 'metadata' | 'duration' | 'stats';
export type TestMetadataPart = 'description' | 'tags' | 'inheritance' | 'classContext' | 'virtualHint';

export const TEST_ROW_PARTS: readonly TestRowPart[] = [
    'expander', 'status', 'kindIcon', 'name', 'metadata', 'duration', 'stats',
];

export const CONFIGURABLE_TEST_ROW_PARTS: readonly TestRowPart[] = TEST_ROW_PARTS.filter(
    (part) => part !== 'expander',
);

export const TEST_ROW_PART_LABELS: Readonly<Record<TestRowPart, string>> = {
    expander: 'Expander',
    status: 'Status',
    kindIcon: 'Kind Icon',
    name: 'Item Name',
    metadata: 'Metadata',
    duration: 'Duration',
    stats: 'Statistics',
};

export const TEST_METADATA_PARTS: readonly TestMetadataPart[] = [
    'description', 'tags', 'inheritance', 'classContext', 'virtualHint',
];

export const TEST_METADATA_PART_LABELS: Readonly<Record<TestMetadataPart, string>> = {
    description: 'Original Name',
    tags: 'Tags',
    inheritance: 'Inherited Source',
    classContext: 'Class Context',
    virtualHint: 'Virtual Test Hint',
};

export function normalizeTestRowParts(value: readonly string[] | undefined): readonly TestRowPart[] {
    if (!value) {
        return [...TEST_ROW_PARTS];
    }
    const selected = new Set(value);
    return ['expander', ...CONFIGURABLE_TEST_ROW_PARTS.filter((part) => selected.has(part))];
}

export function normalizeTestMetadataParts(value: readonly string[] | undefined): readonly TestMetadataPart[] {
    if (!value) {
        return [...TEST_METADATA_PARTS];
    }
    const selected = new Set(value);
    return TEST_METADATA_PARTS.filter((part) => selected.has(part));
}
