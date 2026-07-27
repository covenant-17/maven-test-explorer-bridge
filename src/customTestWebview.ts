import * as vscode from 'vscode';
import { CustomNodeStats, CustomTestNode } from './customTestModel';

export const CUSTOM_VIEW_ID = 'mavenTestExplorer.view';

export interface WebviewState {
    roots: readonly CustomTestNode[];
    stats: CustomNodeStats;
    filterText: string;
    filterError?: string;
    expandedIds: readonly string[];
    selectedId?: string;
    running: boolean;
}

export interface WebviewHandlers {
    refresh(): void | Promise<void>;
    runAll(): void | Promise<void>;
    rerunFailed(): void | Promise<void>;
    clearResults(): void | Promise<void>;
    clearResultsAndHistory(): void | Promise<void>;
    showHistory(): void | Promise<void>;
    applyFilter(value: string): void | Promise<void>;
    clearFilter(): void | Promise<void>;
    openNode(id: string): void | Promise<void>;
    runNode(id: string): void | Promise<void>;
    selectNode(id: string): void | Promise<void>;
    setExpanded(id: string, expanded: boolean): void | Promise<void>;
    copy(kind: string, id?: string): void | Promise<void>;
    attach(kind: 'copilot' | 'claude', id?: string): void | Promise<void>;
}

export class CustomTestWebviewProvider implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;
    private state: WebviewState = {
        roots: [],
        stats: { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 },
        filterText: '',
        expandedIds: [],
        running: false,
    };

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly handlers: WebviewHandlers,
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.renderHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
            void this.handleMessage(message);
        });
        this.postState();
    }

    updateState(state: WebviewState): void {
        this.state = state;
        this.postState();
    }

    private postState(): void {
        this.view?.webview.postMessage({ type: 'stateUpdated', state: this.state });
    }

    private async handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'ready':
                this.postState();
                break;
            case 'refresh':
                await this.handlers.refresh();
                break;
            case 'runAll':
                await this.handlers.runAll();
                break;
            case 'rerunFailed':
                await this.handlers.rerunFailed();
                break;
            case 'clearResults':
                await this.handlers.clearResults();
                break;
            case 'clearResultsAndHistory':
                await this.handlers.clearResultsAndHistory();
                break;
            case 'showHistory':
                await this.handlers.showHistory();
                break;
            case 'applyFilter':
                await this.handlers.applyFilter(message.value ?? '');
                break;
            case 'clearFilter':
                await this.handlers.clearFilter();
                break;
            case 'openNode':
                if (message.id) { await this.handlers.openNode(message.id); }
                break;
            case 'runNode':
                if (message.id) { await this.handlers.runNode(message.id); }
                break;
            case 'selectNode':
                if (message.id) { await this.handlers.selectNode(message.id); }
                break;
            case 'setExpanded':
                if (message.id) { await this.handlers.setExpanded(message.id, Boolean(message.expanded)); }
                break;
            case 'copy':
                await this.handlers.copy(message.kind ?? 'path', message.id);
                break;
            case 'attach':
                if (message.kind === 'copilot' || message.kind === 'claude') {
                    await this.handlers.attach(message.kind, message.id);
                }
                break;
        }
    }

    private renderHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const cspSource = webview.cspSource;
        const codiconFontUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.ttf'));
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maven Test Explorer</title>
    <style>
        @font-face {
            font-family: codicon;
            src: url("${codiconFontUri}") format("truetype");
            font-display: block;
        }
        :root {
            color-scheme: light dark;
            --row-height: 22px;
            --status-width: 16px;
            --action-zone: 48px;
            --meta-width: 132px;
            --tree-indent: 8px;
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            line-height: normal;
            overflow: hidden;
        }
        button,
        input {
            font: inherit;
        }
        .test-explorer {
            height: 100vh;
            min-width: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: var(--vscode-sideBar-background);
        }
        .filter-row {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            min-width: 0;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
        }
        .filter-shell {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            height: 32px;
            display: flex;
            align-items: center;
            gap: 4px;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, transparent);
            padding: 1px 4px;
        }
        .filter-shell:focus-within {
            border-color: var(--vscode-focusBorder);
        }
        .filter-shell.invalid {
            border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        }
        .filter {
            flex: 1 1 auto;
            min-width: 0;
            height: 18px;
            padding: 0;
            color: var(--vscode-input-foreground);
            background: transparent;
            border: 0;
            outline: none;
        }
        .filter::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .icon-button {
            flex: 0 0 auto;
            width: 22px;
            height: 22px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            color: var(--vscode-icon-foreground, var(--vscode-foreground));
            background: transparent;
            border: 0;
            border-radius: 4px;
            cursor: pointer;
        }
        .icon-button:hover:not(:disabled),
        .icon-button.active {
            color: var(--vscode-toolbar-activeForeground, var(--vscode-foreground));
            background: var(--vscode-toolbar-hoverBackground);
        }
        .icon-button:focus-visible,
        .menu-item:focus-visible,
        .row:focus-visible {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        .icon-button:disabled {
            opacity: 0.45;
            cursor: default;
        }
        .codicon {
            width: 16px;
            height: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 16px;
            font-family: codicon;
            font-size: 16px;
            line-height: 16px;
            color: inherit;
        }
        .codicon-filter::before { content: "\\eaf1"; }
        .codicon-clear-all::before { content: "\\eabf"; }
        .codicon-copy::before { content: "\\ebcc"; }
        .codicon-history::before { content: "\\ea82"; }
        .codicon-refresh::before { content: "\\eb37"; }
        .codicon-run::before { content: "\\eb2c"; }
        .codicon-close::before { content: "\\ea76"; }
        .codicon-more::before { content: "\\eab4"; }
        .codicon-passed::before { content: "\\eab2"; }
        .codicon-failed::before { content: "\\ea76"; }
        .codicon-error::before { content: "\\ea87"; }
        .codicon-skipped::before { content: "\\eabd"; }
        .codicon-chevron-down::before { content: "\\eab4"; }
        .codicon-chevron-right::before { content: "\\eab6"; }
        .codicon-namespace::before { content: "\\ea8b"; }
        .codicon-class::before { content: "\\eb5b"; }
        .codicon-method::before { content: "\\ea8c"; }
        .codicon-event::before { content: "\\ea86"; }
        .codicon-root::before { content: "\\ea65"; }
        .codicon-empty::before { content: ""; }
        .summary {
            flex: 0 0 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 36px;
            padding: 6px 8px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
        }
        .summary[hidden] {
            display: none;
        }
        .summary-left,
        .summary-right {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        .summary-left {
            flex: 1 1 auto;
            overflow: hidden;
        }
        .summary-right {
            flex: 0 0 auto;
            margin-left: auto;
        }
        .summary-group {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            min-width: 0;
            overflow: hidden;
        }
        .summary-count {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            min-width: 0;
            line-height: 16px;
        }
        .summary .codicon {
            width: 14px;
            height: 14px;
            flex-basis: 14px;
            font-size: 14px;
            line-height: 14px;
        }
        .passed { color: var(--vscode-testing-iconPassed); }
        .failed { color: var(--vscode-testing-iconFailed); }
        .error { color: var(--vscode-testing-iconErrored, var(--vscode-testing-iconFailed)); }
        .skipped { color: var(--vscode-testing-iconSkipped); }
        .unknown { color: var(--vscode-descriptionForeground); }
        .running-label {
            color: var(--vscode-testing-runAction, var(--vscode-foreground));
        }
        .filter-error {
            flex: 0 0 auto;
            margin: 0 8px 6px;
            padding: 4px 6px;
            color: var(--vscode-errorForeground);
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder, transparent);
            white-space: normal;
        }
        .tree-wrap {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            overflow: hidden;
        }
        .tree {
            position: relative;
            width: 100%;
            height: 100%;
            overflow-x: hidden;
            overflow-y: auto;
            outline: 0;
            user-select: none;
            scrollbar-width: thin;
            scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
        }
        .tree::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        .tree::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
        }
        .tree::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
        .rows {
            position: relative;
            width: 100%;
            min-height: 100%;
        }
        .row {
            position: absolute;
            left: 0;
            width: 100%;
            height: var(--row-height);
            display: flex;
            align-items: center;
            overflow: hidden;
            color: var(--vscode-foreground);
            cursor: default;
            padding-right: 4px;
        }
        .row:hover:not(.selected) {
            color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
            background: var(--vscode-list-hoverBackground);
        }
        .row.selected {
            color: var(--vscode-list-inactiveSelectionForeground, var(--vscode-foreground));
            background: var(--vscode-list-inactiveSelectionBackground);
        }
        .tree:focus .row.selected,
        .row.selected.focused {
            color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
            background: var(--vscode-list-activeSelectionBackground);
            outline: 1px solid var(--vscode-list-focusAndSelectionOutline, var(--vscode-focusBorder));
            outline-offset: -1px;
        }
        .indent-guide {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 1px;
            background: var(--vscode-tree-indentGuidesStroke);
            opacity: 0.85;
        }
        .twisty {
            width: 16px;
            height: var(--row-height);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 16px;
            color: var(--vscode-tree-inactiveIndentGuidesStroke, var(--vscode-descriptionForeground));
            background: transparent;
            border: 0;
            padding: 0;
            cursor: pointer;
            opacity: 0.85;
        }
        .twisty.empty {
            cursor: default;
        }
        .status {
            width: var(--status-width);
            flex-basis: var(--status-width);
            margin-right: 4px;
            font-size: 14px;
            line-height: 14px;
        }
        .label {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 2px;
            height: var(--row-height);
            overflow: hidden;
        }
        .label-text,
        .description,
        .tags,
        .node-stats {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .label-text {
            flex: 0 1 auto;
        }
        .description,
        .tags,
        .node-stats {
            flex: 0 1 auto;
            color: var(--vscode-descriptionForeground);
            margin-left: 4px;
            font-size: 0.92em;
        }
        .row.selected .description,
        .row.selected .tags,
        .row.selected .node-stats {
            color: inherit;
            opacity: 0.9;
        }
        .right-meta {
            flex: 0 0 auto;
            width: auto;
            max-width: min(45%, var(--meta-width));
            min-width: 0;
            display: inline-flex;
            align-items: center;
            justify-content: flex-end;
            gap: 4px;
            padding-right: 4px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            line-height: 16px;
            overflow: hidden;
            white-space: nowrap;
            transition: margin-right 80ms ease;
        }
        .row.selected .right-meta {
            color: inherit;
            opacity: 0.92;
        }
        .row:hover .right-meta,
        .row:focus-within .right-meta {
            margin-right: var(--action-zone);
        }
        .meta-passed { color: var(--vscode-testing-iconPassed); }
        .meta-failed { color: var(--vscode-testing-iconFailed); }
        .meta-error { color: var(--vscode-testing-iconErrored, var(--vscode-testing-iconFailed)); }
        .meta-skipped { color: var(--vscode-testing-iconSkipped); }
        .meta-total,
        .duration {
            color: var(--vscode-descriptionForeground);
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .row.selected .meta-passed,
        .row.selected .meta-failed,
        .row.selected .meta-error,
        .row.selected .meta-skipped,
        .row.selected .meta-total,
        .row.selected .duration {
            color: inherit;
        }
        .actions {
            position: absolute;
            top: 0;
            right: 4px;
            width: var(--action-zone);
            height: var(--row-height);
            display: inline-flex;
            justify-content: flex-end;
            align-items: center;
            gap: 0;
            opacity: 0;
            pointer-events: none;
            background: var(--vscode-list-hoverBackground, var(--vscode-sideBar-background));
        }
        .row:hover .actions,
        .row:focus-within .actions {
            opacity: 1;
            pointer-events: auto;
        }
        .row.selected .actions {
            background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground));
        }
        .empty-state {
            padding: 16px 12px;
            color: var(--vscode-descriptionForeground);
            white-space: normal;
            line-height: 1.45;
        }
        .empty-state strong {
            display: block;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
            font-weight: 600;
        }
        .menu {
            position: fixed;
            z-index: 20;
            min-width: 196px;
            max-width: calc(100vw - 8px);
            padding: 4px 0;
            color: var(--vscode-menu-foreground);
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border, transparent);
            box-shadow: 0 2px 8px var(--vscode-widget-shadow);
        }
        .menu[hidden] {
            display: none;
        }
        .menu-item {
            width: 100%;
            height: 24px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
            color: inherit;
            background: transparent;
            border: 0;
            text-align: left;
            white-space: nowrap;
            cursor: pointer;
        }
        .menu-item:hover,
        .menu-item.active {
            color: var(--vscode-menu-selectionForeground);
            background: var(--vscode-menu-selectionBackground);
        }
        @media (max-width: 260px) {
            .filter-row {
                padding-left: 4px;
                padding-right: 4px;
            }
            .summary {
                gap: 4px;
                padding-left: 4px;
                padding-right: 4px;
            }
            .description,
            .tags,
            .node-stats {
                display: none;
            }
            :root {
                --meta-width: 68px;
                --action-zone: 28px;
            }
        }
    </style>
</head>
<body>
    <div class="test-explorer">
        <div class="filter-row">
            <div id="filterShell" class="filter-shell">
                <span class="codicon codicon-filter" aria-hidden="true"></span>
                <input id="filter" class="filter" aria-label="Filter tests" placeholder="Filter (text, !exclude, @tag, status:failed)">
                <button id="clearFilterButton" class="icon-button" type="button" title="Clear Filter" aria-label="Clear Filter"><span class="codicon codicon-close"></span></button>
            </div>
        </div>
        <div id="summary" class="summary" aria-live="polite"></div>
        <div id="filterError" class="filter-error" hidden></div>
        <div class="tree-wrap">
            <div id="tree" class="tree" tabindex="0" role="tree" aria-label="Maven Test Explorer tree" aria-activedescendant="">
                <div id="rows" class="rows"></div>
            </div>
        </div>
        <div id="copyMenu" class="menu" role="menu" hidden></div>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const ROW_HEIGHT = 22;
        let state = { roots: [], stats: { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 }, expandedIds: [], running: false, filterText: '' };
        let filterTimer;
        let flatRows = [];
        let menuItems = [];
        let menuIndex = -1;
        let menuNode = null;

        const treeEl = document.getElementById('tree');
        let rowsEl = document.getElementById('rows');
        const summaryEl = document.getElementById('summary');
        const filterEl = document.getElementById('filter');
        const filterShellEl = document.getElementById('filterShell');
        const errorEl = document.getElementById('filterError');
        const copyMenuEl = document.getElementById('copyMenu');
        const clearFilterButton = document.getElementById('clearFilterButton');

        clearFilterButton.addEventListener('click', () => {
            filterEl.value = '';
            post('clearFilter');
            filterEl.focus();
        });

        filterEl.addEventListener('input', () => {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => post('applyFilter', { value: filterEl.value }), 180);
        });

        filterEl.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && filterEl.value) {
                event.stopPropagation();
                filterEl.value = '';
                post('clearFilter');
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusSelectedOrFirst();
            }
        });

        treeEl.addEventListener('keydown', handleTreeKeydown);

        document.addEventListener('click', (event) => {
            if (!copyMenuEl.contains(event.target)) {
                hideCopyMenu();
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'stateUpdated') {
                const previousTop = treeEl.scrollTop;
                state = message.state || state;
                render(previousTop);
            }
        });

        post('ready');

        function post(type, payload = {}) {
            vscode.postMessage({ type, ...payload });
        }

        function render(previousTop = treeEl.scrollTop) {
            if (document.activeElement !== filterEl) {
                filterEl.value = state.filterText || '';
            }
            clearFilterButton.hidden = !(state.filterText || filterEl.value);
            filterShellEl.classList.toggle('invalid', Boolean(state.filterError));
            renderSummary();
            renderFilterError();
            renderRows(previousTop);
        }

        function renderSummary() {
            const stats = state.stats || {};
            const total = stats.total || 0;
            const hasResults = state.running || total > 0;
            summaryEl.hidden = !hasResults;
            summaryEl.textContent = '';
            if (!hasResults) {
                return;
            }
            const left = document.createElement('div');
            left.className = 'summary-left';
            left.append(
                summaryCount('passed', 'Passed', stats.passed || 0),
                summaryCount('failed', 'Failed', stats.failed || 0),
                summaryCount('error', 'Errors', stats.error || 0),
                summaryCount('skipped', 'Skipped', stats.skipped || 0),
                textSpan('of ' + total + ' tests', 'summary-group'),
            );
            if (state.running) {
                left.appendChild(textSpan('Running', 'summary-group running-label'));
            }
            const right = document.createElement('div');
            right.className = 'summary-right';
            const duration = totalDuration(state.roots || []);
            if (duration !== undefined) {
                right.appendChild(textSpan(formatDuration(duration), 'duration'));
            }
            right.appendChild(rowAction('codicon-refresh', 'Re-run Failed Tests', () => post('rerunFailed')));
            summaryEl.append(left, right);
        }

        function summaryCount(kind, label, value) {
            const item = document.createElement('span');
            item.className = 'summary-count';
            item.title = label + ': ' + value;
            item.append(iconSpan(statusIcon(kind), kind), textSpan(String(value)));
            return item;
        }

        function renderFilterError() {
            if (state.filterError) {
                errorEl.hidden = false;
                errorEl.textContent = state.filterError;
            } else {
                errorEl.hidden = true;
                errorEl.textContent = '';
            }
        }

        function renderRows(previousTop) {
            rowsEl.replaceChildren();
            flatRows = flattenRoots(state.roots || []);

            if (flatRows.length === 0) {
                rowsEl.style.height = '100%';
                rowsEl.appendChild(emptyState());
                treeEl.removeAttribute('aria-activedescendant');
                return;
            }

            rowsEl.style.height = Math.max(flatRows.length * ROW_HEIGHT, treeEl.clientHeight) + 'px';
            flatRows.forEach((entry, index) => rowsEl.appendChild(renderNode(entry, index)));
            treeEl.scrollTop = Math.min(previousTop, Math.max(0, rowsEl.offsetHeight - treeEl.clientHeight));
            updateActiveDescendant();
        }

        function flattenRoots(roots) {
            const output = [];
            for (const node of roots) {
                flattenNode(node, 0, output);
            }
            return output;
        }

        function flattenNode(node, depth, output) {
            output.push({ node, depth });
            if (!isExpanded(node.id)) {
                return;
            }
            for (const child of node.children || []) {
                flattenNode(child, depth + 1, output);
            }
        }

        function renderNode(entry, index) {
            const node = entry.node;
            const depth = entry.depth;
            const expanded = isExpanded(node.id);
            const hasChildren = Boolean(node.children && node.children.length > 0);
            const selected = state.selectedId === node.id;
            const row = document.createElement('div');
            row.id = rowDomId(node.id);
            row.className = 'row' + (selected ? ' selected focused' : '');
            row.setAttribute('role', 'treeitem');
            row.setAttribute('aria-level', String(depth + 1));
            row.setAttribute('aria-posinset', String(index + 1));
            row.setAttribute('aria-setsize', String(flatRows.length));
            row.setAttribute('aria-selected', selected ? 'true' : 'false');
            if (hasChildren) {
                row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            }
            row.style.top = (index * ROW_HEIGHT) + 'px';
            row.title = titleFor(node);

            for (let i = 0; i < depth; i++) {
                const guide = document.createElement('span');
                guide.className = 'indent-guide';
                guide.style.left = (8 + i * 8) + 'px';
                row.appendChild(guide);
            }

            const twisty = document.createElement('button');
            twisty.className = 'twisty codicon ' + (hasChildren ? (expanded ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'codicon-empty empty');
            twisty.type = 'button';
            twisty.tabIndex = -1;
            twisty.style.marginLeft = (8 + depth * 8) + 'px';
            twisty.title = hasChildren ? (expanded ? 'Collapse' : 'Expand') : '';
            twisty.setAttribute('aria-hidden', hasChildren ? 'false' : 'true');
            twisty.addEventListener('click', (event) => {
                event.stopPropagation();
                if (hasChildren) {
                    selectNode(node.id);
                    post('setExpanded', { id: node.id, expanded: !expanded });
                }
            });

            const status = iconSpan(statusIcon(node.status), 'status ' + (node.status || 'unknown'));
            const label = document.createElement('div');
            label.className = 'label';
            const kindIcon = kindIconFor(node.kind);
            if (kindIcon) {
                label.appendChild(iconSpan(kindIcon));
            }
            label.appendChild(textSpan(node.label, 'label-text'));
            appendMetadata(label, node, hasChildren);

            const rightMeta = document.createElement('div');
            rightMeta.className = 'right-meta';
            appendRightMeta(rightMeta, node, hasChildren);

            const actions = document.createElement('div');
            actions.className = 'actions';
            actions.append(
                rowAction('codicon-run', 'Run Test', () => post('runNode', { id: node.id })),
                rowAction('codicon-copy', 'Copy...', (event) => {
                    selectNode(node.id);
                    showCopyMenu(node, event.clientX, event.clientY);
                }),
            );

            row.append(twisty, status, label, rightMeta, actions);
            row.addEventListener('click', () => {
                hideCopyMenu();
                selectNode(node.id);
            });
            row.addEventListener('dblclick', () => {
                post('openNode', { id: node.id });
            });
            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                selectNode(node.id);
                showCopyMenu(node, event.clientX, event.clientY);
            });
            return row;
        }

        function appendMetadata(label, node, hasChildren) {
            const tags = (node.tags || []).slice(0, 2).map(tag => '@' + tag).join(' ');
            if (node.description) {
                label.appendChild(textSpan(node.description, 'description'));
            }
            if (tags) {
                label.appendChild(textSpan(tags, 'tags'));
            }
        }

        function appendRightMeta(container, node, hasChildren) {
            if (hasChildren) {
                const stats = node.stats || {};
                if (!stats.total) {
                    return;
                }
                appendMetaPart(container, stats.passed || 0, 'passed');
                appendMetaPart(container, stats.failed || 0, 'failed');
                appendMetaPart(container, stats.error || 0, 'error');
                appendMetaPart(container, stats.skipped || 0, 'skipped');
                const total = textSpan(String(stats.total), 'meta-total');
                total.title = 'Total: ' + stats.total;
                container.appendChild(total);
                return;
            }
            if (typeof node.durationMs === 'number') {
                container.appendChild(textSpan(formatDuration(node.durationMs), 'duration'));
            }
        }

        function appendMetaPart(container, value, kind) {
            if (!value) {
                return;
            }
            const span = textSpan(String(value) + metaSuffix(kind), 'meta-' + kind);
            span.title = kind + ': ' + value;
            container.appendChild(span);
        }

        function metaSuffix(kind) {
            if (kind === 'passed') return '✓';
            if (kind === 'failed') return 'X';
            if (kind === 'error') return '!';
            if (kind === 'skipped') return '○';
            return '';
        }

        function rowAction(iconClass, title, onClick) {
            const button = document.createElement('button');
            button.className = 'icon-button';
            button.type = 'button';
            button.title = title;
            button.setAttribute('aria-label', title);
            button.tabIndex = -1;
            button.appendChild(iconSpan(iconClass));
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                onClick(event);
            });
            return button;
        }

        function emptyState() {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            if (state.filterText) {
                empty.append(textSpan('No matching tests', ''));
                empty.appendChild(document.createElement('br'));
                empty.appendChild(textSpan('Adjust or clear the filter to show the full Maven tree.'));
            } else if (state.running) {
                empty.appendChild(textSpan('Discovering Maven test sources...'));
            } else {
                const title = document.createElement('strong');
                title.textContent = 'No tests found';
                empty.append(title, textSpan('Make sure this workspace contains a Maven project with JUnit tests.'));
            }
            return empty;
        }

        function handleTreeKeydown(event) {
            if (event.key === 'Escape') {
                if (!copyMenuEl.hidden) {
                    event.preventDefault();
                    hideCopyMenu();
                }
                return;
            }
            if (!flatRows.length) {
                return;
            }
            const selectedIndex = selectedRowIndex();
            const index = selectedIndex >= 0 ? selectedIndex : 0;
            const entry = flatRows[index];
            if (!entry) {
                return;
            }
            const node = entry.node;
            const hasChildren = Boolean(node.children && node.children.length > 0);
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                selectVisibleIndex(Math.min(index + 1, flatRows.length - 1));
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                selectVisibleIndex(Math.max(index - 1, 0));
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                if (hasChildren && isExpanded(node.id)) {
                    post('setExpanded', { id: node.id, expanded: false });
                } else if (node.parentId) {
                    selectNode(node.parentId);
                }
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                if (hasChildren && !isExpanded(node.id)) {
                    post('setExpanded', { id: node.id, expanded: true });
                } else if (hasChildren && node.children.length) {
                    selectNode(node.children[0].id);
                }
            } else if (event.key === 'Enter') {
                event.preventDefault();
                post('openNode', { id: node.id });
            } else if (event.key === ' ') {
                event.preventDefault();
                post('runNode', { id: node.id });
            } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                const row = document.getElementById(rowDomId(node.id));
                const rect = row ? row.getBoundingClientRect() : treeEl.getBoundingClientRect();
                showCopyMenu(node, rect.left + 24, rect.top + ROW_HEIGHT);
            }
        }

        function selectVisibleIndex(index) {
            const entry = flatRows[index];
            if (entry) {
                selectNode(entry.node.id);
                scrollRowIntoView(index);
            }
        }

        function selectedRowIndex() {
            return flatRows.findIndex(entry => entry.node.id === state.selectedId);
        }

        function focusSelectedOrFirst() {
            treeEl.focus();
            if (selectedRowIndex() < 0 && flatRows.length) {
                selectVisibleIndex(0);
            }
        }

        function scrollRowIntoView(index) {
            const top = index * ROW_HEIGHT;
            const bottom = top + ROW_HEIGHT;
            if (top < treeEl.scrollTop) {
                treeEl.scrollTop = top;
            } else if (bottom > treeEl.scrollTop + treeEl.clientHeight) {
                treeEl.scrollTop = bottom - treeEl.clientHeight;
            }
        }

        function selectNode(id) {
            if (state.selectedId !== id) {
                state = { ...state, selectedId: id };
                post('selectNode', { id });
            }
            updateSelectedRows(id);
        }

        function updateSelectedRows(id) {
            for (const row of rowsEl.querySelectorAll('.row')) {
                const selected = row.id === rowDomId(id);
                row.classList.toggle('selected', selected);
                row.classList.toggle('focused', selected);
                row.setAttribute('aria-selected', selected ? 'true' : 'false');
            }
            updateActiveDescendant();
        }

        function updateActiveDescendant() {
            if (state.selectedId) {
                treeEl.setAttribute('aria-activedescendant', rowDomId(state.selectedId));
            } else {
                treeEl.removeAttribute('aria-activedescendant');
            }
        }

        function showCopyMenu(node, x, y) {
            menuNode = node;
            copyMenuEl.textContent = '';
            menuItems = copyOptions(node).map(([kind, label]) => {
                const item = document.createElement('button');
                item.className = 'menu-item';
                item.type = 'button';
                item.setAttribute('role', 'menuitem');
                item.tabIndex = -1;
                item.append(iconSpan('codicon-copy'), textSpan(label));
                item.addEventListener('click', (event) => {
                    event.stopPropagation();
                    post('copy', { id: node.id, kind });
                    hideCopyMenu();
                });
                copyMenuEl.appendChild(item);
                return item;
            });
            if (menuItems.length === 0) {
                return;
            }
            copyMenuEl.hidden = false;
            const maxLeft = window.innerWidth - copyMenuEl.offsetWidth - 4;
            const maxTop = window.innerHeight - copyMenuEl.offsetHeight - 4;
            copyMenuEl.style.left = Math.max(4, Math.min(x, maxLeft)) + 'px';
            copyMenuEl.style.top = Math.max(4, Math.min(y, maxTop)) + 'px';
            setMenuIndex(0);
            copyMenuEl.addEventListener('keydown', handleMenuKeydown);
            menuItems[0].focus();
        }

        function handleMenuKeydown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                hideCopyMenu();
                treeEl.focus();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMenuIndex((menuIndex + 1) % menuItems.length);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setMenuIndex((menuIndex - 1 + menuItems.length) % menuItems.length);
            } else if ((event.key === 'Enter' || event.key === ' ') && menuItems[menuIndex]) {
                event.preventDefault();
                menuItems[menuIndex].click();
            }
        }

        function setMenuIndex(index) {
            menuIndex = index;
            menuItems.forEach((item, itemIndex) => {
                item.classList.toggle('active', itemIndex === menuIndex);
                item.tabIndex = itemIndex === menuIndex ? 0 : -1;
            });
            menuItems[menuIndex]?.focus();
        }

        function hideCopyMenu() {
            copyMenuEl.hidden = true;
            copyMenuEl.textContent = '';
            copyMenuEl.removeEventListener('keydown', handleMenuKeydown);
            menuItems = [];
            menuIndex = -1;
            menuNode = null;
        }

        function copyOptions(node) {
            return [
                ['maven', 'Copy Maven Command'],
                ['package', 'Copy Package Name'],
                ['class', 'Copy Class Name (FQCN)'],
                ['file', 'Copy Full Path'],
                ['method', 'Copy Method Name'],
            ].filter(([kind]) => canCopyKind(node, kind));
        }

        function canCopyKind(node, kind) {
            if (kind === 'maven') return true;
            if (kind === 'package') return Boolean(node.packageName);
            if (kind === 'class') return Boolean(node.fqcn);
            if (kind === 'file') return Boolean(node.sourcePath);
            if (kind === 'method') return Boolean(node.methodName);
            return true;
        }

        function isExpanded(id) {
            return (state.expandedIds || []).includes(id);
        }

        function rowDomId(id) {
            return 'row-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
        }

        function iconSpan(iconClass, extraClass = '') {
            const span = document.createElement('span');
            span.className = ('codicon ' + iconClass + ' ' + extraClass).trim();
            return span;
        }

        function textSpan(value, className = '') {
            const span = document.createElement('span');
            span.textContent = value;
            if (className) {
                span.className = className;
            }
            return span;
        }

        function statusIcon(status) {
            if (status === 'passed') return 'codicon-passed';
            if (status === 'failed') return 'codicon-failed';
            if (status === 'error') return 'codicon-error';
            if (status === 'skipped') return 'codicon-skipped';
            return 'codicon-empty';
        }

        function kindIconFor(kind) {
            if (kind === 'module') return 'codicon-root';
            if (kind === 'package') return 'codicon-namespace';
            if (kind === 'class') return 'codicon-class';
            if (kind === 'method' || kind === 'virtualMethod') return 'codicon-method';
            if (kind === 'lifecycle') return 'codicon-event';
            return '';
        }

        function totalDuration(roots) {
            let total = 0;
            let found = false;
            for (const node of roots) {
                const childDuration = totalDurationForNode(node);
                if (childDuration !== undefined) {
                    found = true;
                    total += childDuration;
                }
            }
            return found ? total : undefined;
        }

        function totalDurationForNode(node) {
            if (typeof node.durationMs === 'number') {
                return node.durationMs;
            }
            let total = 0;
            let found = false;
            for (const child of node.children || []) {
                const duration = totalDurationForNode(child);
                if (duration !== undefined) {
                    found = true;
                    total += duration;
                }
            }
            return found ? total : undefined;
        }

        function formatDuration(durationMs) {
            if (durationMs < 1000) return Math.max(0, durationMs).toFixed(durationMs < 10 ? 1 : 0) + 'ms';
            return (durationMs / 1000).toFixed(1) + 's';
        }

        function titleFor(node) {
            const parts = [node.fqcn || node.packageName || node.label];
            if (node.methodName) parts.push(node.methodName);
            if (node.tags && node.tags.length) parts.push('@' + node.tags.join(' @'));
            if (node.isVirtual) parts.push('Virtual test, opens parent method');
            return parts.filter(Boolean).join('\\n');
        }
    </script>
</body>
</html>`;
    }
}

interface WebviewMessage {
    type: string;
    id?: string;
    value?: string;
    expanded?: boolean;
    kind?: string;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
