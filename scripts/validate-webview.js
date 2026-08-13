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

console.log('[validate-webview] Generated webview JavaScript syntax is valid.');
