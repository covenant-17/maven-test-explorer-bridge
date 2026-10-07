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

const showTooltipStart = source.indexOf('function showNodeTooltip(');
const tooltipPositionReset = source.indexOf("nodeTooltipEl.style.left = margin + 'px';", showTooltipStart);
const tooltipWidthMeasurement = source.indexOf('nodeTooltipEl.offsetWidth', showTooltipStart);
if (showTooltipStart < 0 || tooltipPositionReset < showTooltipStart || tooltipPositionReset > tooltipWidthMeasurement) {
    throw new Error('Tooltips must be positioned against the viewport before measuring their width.');
}

for (const profilePickerInvariant of [
    'id="profileButton"',
    'id="profileCount"',
    'function profileDescriptionTooltip(profile)',
    "repository + ' · ' + profile",
    "iconSpan(selected ? 'codicon-check' : 'codicon-add')",
    '.codicon-add::before { content: "\\\\ea60"; }',
    '.codicon-check::before { content: "\\\\eab2"; }',
    "toggle.addEventListener('click'",
    "post('selectProfile', { profiles: state.activeProfiles })",
    "post('openProfile', { value })",
    "profileButtonEl.dataset.multiple = multiple ? 'true' : 'false'",
    'profileCountEl.hidden = !multiple',
    "activeProfiles.length > 9 ? '9+' : String(activeProfiles.length)",
    '.profile-button[data-multiple="true"]',
]) {
    if (!source.includes(profilePickerInvariant)) {
        throw new Error(`Missing Maven profile picker invariant: ${profilePickerInvariant}`);
    }
}

console.log('[validate-webview] Generated webview JavaScript syntax and layout invariants are valid.');
