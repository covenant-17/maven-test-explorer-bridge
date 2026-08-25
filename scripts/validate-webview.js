const fs = require('node:fs');

const source = fs.readFileSync('src/customTestWebview.ts', 'utf8');
const openingTag = '<script nonce="${nonce}">';
const start = source.indexOf(openingTag);
const end = source.indexOf('</script>', start + openingTag.length);

if (start < 0 || end < 0) {
    throw new Error('Unable to locate the custom webview script.');
}

const templateSource = source.slice(start + openingTag.length, end);
if (templateSource.includes('`') || templateSource.includes('${')) {
    throw new Error('Webview validator must be updated to handle template expressions.');
}

const generatedScript = Function(`return \`${templateSource}\`;`)();
Function(generatedScript);

const rightMetaRule = source.match(/\.right-meta\s*\{([^}]*)\}/)?.[1] || '';
if (!/flex:\s*0\s+0\s+auto\s*;/.test(rightMetaRule)) {
    throw new Error('Row statistics must not shrink behind the test name.');
}

if (!source.includes("Boolean(state.runSummary?.failed)")) {
    throw new Error('Failed Maven runs must keep zero-result summaries visible.');
}

if (source.includes("textSpan('Maven failed'") || source.includes('failed-label')) {
    throw new Error('Failed Maven runs must not add a dedicated summary badge.');
}

console.log('[validate-webview] Generated webview JavaScript syntax and layout invariants are valid.');
