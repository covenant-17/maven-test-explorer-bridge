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
            --indent: 16px;
        }
        body {
            margin: 0;
            padding: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            overflow: hidden;
        }
        .test-explorer {
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .test-explorer-header {
            flex: 0 0 auto;
            padding: 0;
            background: var(--vscode-sideBar-background);
        }
        .testing-filter-action-bar,
        .testing-filter-action-bar .actions-container {
            display: block;
            min-width: 0;
            width: auto;
            height: 25.7px;
            margin: 4px 12px;
            padding: 0;
            list-style: none;
            white-space: nowrap;
        }
        .testing-filter-action-bar .actions-container {
            display: flex;
            align-items: center;
            height: 100%;
            margin: 0;
            width: 100%;
        }
        .testing-filter-action-item {
            display: flex;
            position: relative;
            align-items: center;
            min-width: 0;
            flex: 1 1 auto;
            height: 25.7px;
            padding: 0;
            white-space: nowrap;
        }
        .testing-filter-wrapper {
            display: block;
            min-width: 0;
            flex: 1 1 auto;
            white-space: nowrap;
        }
        .suggest-input-container {
            position: relative;
            width: 100%;
            min-width: 0;
            height: 20px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 4px;
            padding: 2px 6px;
        }
        .filter {
            width: 100%;
            height: 14px;
            padding: 0;
            color: var(--vscode-input-foreground);
            background: transparent;
            border: 0;
            outline: none;
            font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
            font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
            line-height: 14px;
        }
        .suggest-input-container:focus-within {
            border-color: var(--vscode-focusBorder);
        }
        .filter::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .monaco-action-bar,
        .monaco-action-bar .actions-container {
            display: flex;
            align-items: center;
            height: 100%;
            margin: 0;
            padding: 0;
            list-style: none;
        }
        .action-item {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
        }
        button.action-label {
            width: 16px;
            height: 16px;
            padding: 3px;
            border: 0;
            color: var(--vscode-icon-foreground, var(--vscode-foreground));
            background: transparent;
            border-radius: 6px;
            font-family: codicon;
            font-size: 16px;
            line-height: 16px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        button.action-label:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .codicon {
            width: 16px;
            height: 16px;
            display: inline-block;
            flex: 0 0 auto;
            color: inherit;
            font-family: codicon;
            font-size: 16px;
            line-height: 16px;
        }
        .codicon-filter::before,
        .codicon-testing-filter::before { content: "\\eaf1"; }
        .codicon-clear-all::before { content: "\\eabf"; }
        .codicon-copy::before { content: "\\ebcc"; }
        .codicon-history::before { content: "\\ea82"; }
        .codicon-testing-refresh-tests::before { content: "\\eb37"; }
        .codicon-testing-run-all-icon::before,
        .codicon-testing-run-icon::before,
        .codicon-testing-rerun-icon::before { content: "\\eb2c"; }
        .codicon-testing-passed-icon::before { content: "\\eab2"; }
        .codicon-testing-failed-icon::before { content: "\\ea76"; }
        .codicon-testing-error-icon::before { content: "\\ea87"; }
        .codicon-testing-skipped-icon::before { content: "\\eabd"; }
        .codicon-tree-item-expanded::before { content: "\\eab4"; }
        .codicon-tree-item-expanded.collapsed::before { content: "\\eab6"; }
        .codicon-symbol-namespace::before { content: "\\ea8b"; }
        .codicon-symbol-class::before { content: "\\eb5b"; }
        .codicon-symbol-method::before { content: "\\ea8c"; }
        .codicon-symbol-event::before { content: "\\ea86"; }
        .codicon-testing-hidden::before { content: ""; }
        .result-summary-container {
            flex: 0 0 auto;
            display: block;
            box-sizing: border-box;
            padding: 0 12px 8px;
            min-height: 0;
            height: 27px;
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-sideBar-background);
        }
        .result-summary {
            display: flex;
            align-items: center;
            gap: 2px;
            height: 18.2px;
            line-height: 18px;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }
        .result-summary .codicon-testing-passed-icon { color: var(--vscode-testing-iconPassed); }
        .result-summary .codicon-testing-failed-icon { color: var(--vscode-testing-iconFailed); }
        .result-summary .codicon-testing-error-icon { color: var(--vscode-testing-iconErrored, var(--vscode-testing-iconFailed)); }
        duration {
            color: var(--vscode-descriptionForeground);
        }
        .filter-error {
            padding: 4px 8px;
            color: var(--vscode-errorForeground);
            background: var(--vscode-inputValidation-errorBackground);
            flex: 0 0 auto;
        }
        .test-explorer-tree {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            overflow: hidden;
        }
        .monaco-list {
            position: relative;
            height: 100%;
            width: 100%;
            white-space: nowrap;
            overflow-x: hidden;
            overflow-y: auto;
            outline: 0 !important;
            user-select: none;
            scrollbar-width: thin;
            scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
        }
        .monaco-list::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        .monaco-list::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
        }
        .monaco-list::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
        .monaco-list-rows {
            position: relative;
            width: 100%;
            min-height: 100%;
            overflow: hidden;
        }
        .monaco-list-row {
            position: absolute;
            box-sizing: border-box;
            left: 0;
            width: 100%;
            height: var(--row-height);
            line-height: var(--row-height);
            overflow: hidden;
            cursor: default;
        }
        .monaco-list-row:hover:not(.selected):not(.focused) {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-list-hoverForeground);
        }
        .monaco-list-row.selected {
            color: var(--vscode-list-inactiveSelectionForeground);
            background: var(--vscode-list-inactiveSelectionBackground);
            outline: 1px dotted var(--vscode-contrastActiveBorder);
            outline-offset: -1px;
        }
        .monaco-list:focus .monaco-list-row.selected,
        .monaco-list-row.selected.focused {
            color: var(--vscode-list-activeSelectionForeground);
            background: var(--vscode-list-activeSelectionBackground);
            outline: 1px solid var(--vscode-list-focusAndSelectionOutline, var(--vscode-contrastActiveBorder, var(--vscode-list-focusOutline)));
            outline-offset: -1px;
        }
        .monaco-tl-row {
            display: flex;
            position: relative;
            align-items: center;
            height: var(--row-height);
            line-height: var(--row-height);
        }
        .monaco-tl-indent {
            height: var(--row-height);
            position: absolute;
        }
        .indent-guide {
            height: 100%;
            border-left: 1px solid var(--vscode-tree-indentGuidesStroke);
            opacity: 1;
            margin-left: 7px;
        }
        .monaco-tl-twistie {
            display: flex;
            align-items: center;
            flex: 0 0 auto;
            width: 16px;
            height: var(--row-height);
            padding: 0 6px 0 8px;
            line-height: 16px;
            font-size: 16px;
            color: var(--vscode-tree-inactiveIndentGuidesStroke, var(--vscode-descriptionForeground));
            cursor: pointer;
            transform: translateX(3px);
        }
        .monaco-tl-twistie.empty {
            cursor: default;
        }
        .monaco-tl-twistie-placeholder {
            display: flex;
            align-items: center;
            flex: 0 0 auto;
            width: 16px;
            height: var(--row-height);
            padding: 0 6px 0 8px;
            line-height: 16px;
        }
        .testing-stdtree-container {
            display: flex;
            align-items: center;
            flex: 1 1 0%;
            height: 100%;
            overflow: hidden;
            padding: 0;
            white-space: nowrap;
        }
        .computed-state {
            width: 16px;
            height: 16px;
            line-height: 16px;
            margin: 0 4px 0 0;
            flex: 0 1 auto;
            overflow: visible;
        }
        .computed-state.passed { color: var(--vscode-testing-iconPassed); }
        .computed-state.failed { color: var(--vscode-testing-iconFailed); }
        .computed-state.error { color: var(--vscode-testing-iconErrored, var(--vscode-testing-iconFailed)); }
        .computed-state.skipped { color: var(--vscode-testing-iconSkipped); }
        .computed-state,
        .computed-state::before {
            background: transparent !important;
        }
        .label {
            display: flex;
            align-items: center;
            flex: 1 1 auto;
            width: 0;
            height: var(--row-height);
            line-height: var(--row-height);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .label .codicon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            line-height: 16px;
            flex: 0 0 16px;
            font-size: 1em;
            transform: scale(1.25);
            margin: 0 2px 0 0;
        }
        .label-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 0 1 auto;
            min-width: 0;
        }
        .test-label-description {
            color: var(--vscode-descriptionForeground);
            margin-left: 5.85px;
            font-size: 11.7px;
            line-height: var(--row-height);
            white-space: pre;
            opacity: 0.7;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 0 1 auto;
            min-width: 0;
        }
        .monaco-list-row.selected .test-label-description {
            color: inherit;
        }
        .codicon-testing-hidden {
            opacity: 0;
        }
        .row-actions {
            display: none;
            height: 100%;
            flex: 0 0 auto;
            margin-right: 0.8em;
        }
        .monaco-list-row:hover .row-actions,
        .monaco-list-row.selected .row-actions {
            display: initial;
        }
        .row-actions .action-label {
            width: 20px;
            height: 20px;
            color: inherit;
        }
        .copy-menu {
            position: fixed;
            z-index: 20;
            min-width: 190px;
            padding: 4px 0;
            background: var(--vscode-menu-background);
            color: var(--vscode-menu-foreground);
            border: 1px solid var(--vscode-menu-border, transparent);
            border-radius: 6px;
            box-shadow: 0 2px 8px var(--vscode-widget-shadow);
        }
        .copy-menu[hidden] {
            display: none;
        }
        .copy-menu-item {
            height: 22px;
            line-height: 22px;
            padding: 0 12px;
            white-space: nowrap;
            cursor: pointer;
        }
        .copy-menu-item:hover {
            color: var(--vscode-menu-selectionForeground);
            background: var(--vscode-menu-selectionBackground);
        }
        .empty {
            padding: 12px 8px;
            color: var(--vscode-descriptionForeground);
            white-space: normal;
        }
    </style>
</head>
<body>
    <div class="test-explorer">
    <div class="test-explorer-header">
        <div class="monaco-action-bar testing-filter-action-bar">
            <ul class="actions-container" role="toolbar">
                <li class="action-item testing-filter-action-item" role="presentation">
                    <div class="testing-filter-wrapper">
                        <div class="suggest-input-container">
                            <input id="filter" class="filter" aria-label="Filter" placeholder="Filter (e.g. text, !exclude, @tag)">
                        </div>
                    </div>
                    <div class="monaco-action-bar">
                        <ul class="actions-container" role="toolbar">
                            <li class="action-item"><button id="filterButton" class="action-label codicon codicon-testing-filter" title="More Filters"></button></li>
                        </ul>
                    </div>
                </li>
            </ul>
        </div>
    </div>
    <div id="summary" class="result-summary-container"></div>
    <div id="filterError" class="filter-error" hidden></div>
    <div class="test-explorer-tree">
        <div id="tree" class="monaco-list list_id_maven mouse-support last-focused element-focused selection-single" tabindex="0" role="tree" aria-label="Test Explorer">
            <div id="rows" class="monaco-list-rows"></div>
        </div>
    </div>
    <div id="copyMenu" class="copy-menu" hidden></div>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let state = { roots: [], stats: { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 }, expandedIds: [], running: false, filterText: '' };
        let filterTimer;

        const treeEl = document.getElementById('tree');
        let rowsEl = document.getElementById('rows');
        const summaryEl = document.getElementById('summary');
        const filterEl = document.getElementById('filter');
        const errorEl = document.getElementById('filterError');
        const copyMenuEl = document.getElementById('copyMenu');

        document.getElementById('filterButton').addEventListener('click', () => filterEl.focus());

        filterEl.addEventListener('input', () => {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => post('applyFilter', { value: filterEl.value }), 180);
        });
        document.addEventListener('click', (event) => {
            if (!copyMenuEl.contains(event.target)) {
                hideCopyMenu();
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'stateUpdated') {
                state = message.state;
                render();
            }
        });
        post('ready');

        function post(type, payload = {}) {
            vscode.postMessage({ type, ...payload });
        }

        function render() {
            if (document.activeElement !== filterEl) {
                filterEl.value = state.filterText || '';
            }
            const stats = state.stats || {};
            const failed = (stats.failed || 0) + (stats.error || 0);
            const counted = (stats.passed || 0) + failed;
            summaryEl.textContent = '';
            const summary = document.createElement('div');
            summary.className = 'result-summary';
            summary.append(
                iconSpan(failed > 0 ? (stats.error ? 'codicon-testing-error-icon' : 'codicon-testing-failed-icon') : 'codicon-testing-passed-icon'),
                textSpan((stats.passed || 0) + '/' + counted),
            );
            if (state.running) {
                summary.append(textSpan('running'));
            }
            if (stats.skipped) {
                summary.append(textSpan('skipped ' + stats.skipped));
            }
            summary.appendChild(rerunButton());
            summaryEl.appendChild(summary);
            if (state.filterError) {
                errorEl.hidden = false;
                errorEl.textContent = state.filterError;
            } else {
                errorEl.hidden = true;
                errorEl.textContent = '';
            }
            treeEl.textContent = '';
            rowsEl = document.createElement('div');
            rowsEl.id = 'rows';
            rowsEl.className = 'monaco-list-rows';
            treeEl.appendChild(rowsEl);
            const roots = state.roots || [];
            if (roots.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty';
                empty.textContent = 'No tests found';
                rowsEl.appendChild(empty);
                return;
            }
            const flat = [];
            for (const node of roots) {
                flattenNode(node, 0, flat);
            }
            rowsEl.style.height = Math.max(flat.length * 22, treeEl.clientHeight) + 'px';
            flat.forEach((entry, index) => {
                renderNode(entry.node, entry.depth, index, flat.length);
            });
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

        function renderNode(node, depth, index, total) {
            const expanded = isExpanded(node.id);
            const hasChildren = node.children && node.children.length > 0;
            const row = document.createElement('div');
            row.className = 'monaco-list-row' + (state.selectedId === node.id ? ' focused selected' : '');
            row.setAttribute('role', 'treeitem');
            row.setAttribute('aria-level', String(depth + 1));
            row.setAttribute('aria-setsize', String(total));
            row.setAttribute('aria-posinset', String(index + 1));
            row.setAttribute('aria-selected', state.selectedId === node.id ? 'true' : 'false');
            row.style.top = (index * 22) + 'px';
            row.style.height = '22px';
            row.style.lineHeight = '22px';
            row.title = titleFor(node);
            row.addEventListener('click', () => {
                hideCopyMenu();
                post('selectNode', { id: node.id });
                if (hasChildren) {
                    post('setExpanded', { id: node.id, expanded: !expanded });
                }
            });
            row.addEventListener('dblclick', () => {
                if (!hasChildren) {
                    post('openNode', { id: node.id });
                }
            });
            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                post('selectNode', { id: node.id });
                showCopyMenu(node, event.clientX, event.clientY);
            });

            const tlRow = document.createElement('div');
            tlRow.className = 'monaco-tl-row';

            const indent = document.createElement('div');
            indent.className = 'monaco-tl-indent';
            indent.style.width = (depth * 8) + 'px';
            if (depth > 0) {
                const guide = document.createElement('div');
                guide.className = 'indent-guide active';
                indent.appendChild(guide);
            }

            const twisty = document.createElement('div');
            if (hasChildren) {
                twisty.className = 'monaco-tl-twistie codicon codicon-tree-item-expanded' + (!expanded ? ' collapsed' : '');
                twisty.style.paddingLeft = (8 + depth * 8) + 'px';
                twisty.addEventListener('click', (event) => {
                    event.stopPropagation();
                    hideCopyMenu();
                    post('selectNode', { id: node.id });
                    post('setExpanded', { id: node.id, expanded: !expanded });
                });
            } else {
                twisty.className = 'monaco-tl-twistie-placeholder';
                twisty.style.paddingLeft = (8 + depth * 8) + 'px';
            }

            const contents = document.createElement('div');
            contents.className = 'monaco-tl-contents testing-stdtree-container';

            const status = iconSpan(statusIcon(node.status));
            status.classList.add('computed-state', node.status || 'unknown');

            const label = document.createElement('div');
            label.className = 'label';
            const kindIcon = kindIconFor(node.kind);
            if (kindIcon) {
                label.appendChild(iconSpan(kindIcon));
                label.appendChild(document.createTextNode(' '));
            }
            const labelText = document.createElement('span');
            labelText.className = 'label-text';
            labelText.textContent = node.label;
            label.appendChild(labelText);
            const descriptionText = statsText(node, hasChildren);
            if (descriptionText || node.description) {
                const description = document.createElement('span');
                description.className = 'test-label-description';
                description.textContent = (node.description ? node.description + ' ' : '') + descriptionText;
                label.appendChild(description);
            }

            const hidden = iconSpan('codicon-testing-hidden');
            const actions = document.createElement('div');
            actions.className = 'monaco-action-bar row-actions';
            const actionList = document.createElement('ul');
            actionList.className = 'actions-container';
            actionList.setAttribute('role', 'toolbar');
            actionList.appendChild(actionItem(iconButton('codicon-testing-run-icon', 'Run Test', () => post('runNode', { id: node.id }))));
            actionList.appendChild(actionItem(iconButton('codicon-copy', 'Copy...', (event) => showCopyMenu(node, event.clientX, event.clientY))));
            actions.appendChild(actionList);

            contents.append(status, label, hidden, actions);
            tlRow.append(indent, twisty, contents);
            row.appendChild(tlRow);
            rowsEl.appendChild(row);
        }

        function iconButton(iconClass, title, onClick) {
            const button = document.createElement('button');
            button.className = 'action-label codicon ' + iconClass;
            button.type = 'button';
            button.title = title;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                onClick(event);
            });
            return button;
        }

        function showCopyMenu(node, x, y) {
            copyMenuEl.textContent = '';
            const options = [
                ['maven', 'Copy Maven Command'],
                ['package', 'Copy Package Name'],
                ['class', 'Copy Class Name (FQCN)'],
                ['file', 'Copy Full Path'],
                ['method', 'Copy Method Name'],
            ].filter(([kind]) => canCopyKind(node, kind));
            for (const [kind, label] of options) {
                const item = document.createElement('div');
                item.className = 'copy-menu-item';
                item.textContent = label;
                item.addEventListener('click', (event) => {
                    event.stopPropagation();
                    post('copy', { id: node.id, kind });
                    hideCopyMenu();
                });
                copyMenuEl.appendChild(item);
            }
            copyMenuEl.hidden = false;
            const maxLeft = window.innerWidth - copyMenuEl.offsetWidth - 4;
            const maxTop = window.innerHeight - copyMenuEl.offsetHeight - 4;
            copyMenuEl.style.left = Math.max(4, Math.min(x, maxLeft)) + 'px';
            copyMenuEl.style.top = Math.max(4, Math.min(y, maxTop)) + 'px';
        }

        function hideCopyMenu() {
            copyMenuEl.hidden = true;
        }

        function canCopyKind(node, kind) {
            if (kind === 'maven') return true;
            if (kind === 'package') return Boolean(node.packageName);
            if (kind === 'class') return Boolean(node.fqcn);
            if (kind === 'file') return Boolean(node.sourcePath);
            if (kind === 'method') return Boolean(node.methodName);
            return true;
        }

        function actionItem(child) {
            const item = document.createElement('li');
            item.className = 'action-item menu-entry';
            item.setAttribute('role', 'presentation');
            item.appendChild(child);
            return item;
        }

        function iconSpan(iconClass) {
            const span = document.createElement('span');
            span.className = 'codicon ' + iconClass;
            return span;
        }

        function textSpan(value) {
            const span = document.createElement('span');
            span.textContent = value;
            return span;
        }

        function rerunButton() {
            const link = document.createElement('a');
            link.style.display = 'block';
            const bar = document.createElement('div');
            bar.className = 'monaco-action-bar';
            const list = document.createElement('ul');
            list.className = 'actions-container';
            list.setAttribute('role', 'toolbar');
            list.appendChild(actionItem(iconButton('codicon-testing-rerun-icon', 'Rerun Last Run', () => post('rerunFailed'))));
            bar.appendChild(list);
            link.appendChild(bar);
            return link;
        }

        function isExpanded(id) {
            return (state.expandedIds || []).includes(id);
        }

        function statusIcon(status) {
            if (status === 'passed') return 'codicon-testing-passed-icon';
            if (status === 'failed') return 'codicon-testing-failed-icon';
            if (status === 'error') return 'codicon-testing-error-icon';
            if (status === 'skipped') return 'codicon-testing-skipped-icon';
            return 'codicon-testing-hidden';
        }

        function kindIconFor(kind) {
            if (kind === 'package') return 'codicon-symbol-namespace';
            if (kind === 'class') return 'codicon-symbol-class';
            if (kind === 'method' || kind === 'virtualMethod') return 'codicon-symbol-method';
            if (kind === 'lifecycle') return 'codicon-symbol-event';
            return '';
        }

        function statsText(node, hasChildren) {
            const stats = node.stats;
            const durationMs = node.durationMs;
            if (!hasChildren) {
                return typeof durationMs === 'number' ? formatDuration(durationMs) : '';
            }
            if (!stats || !stats.total) return '';
            const failed = (stats.failed || 0) + (stats.error || 0);
            const duration = typeof durationMs === 'number' ? ' : ' + formatDuration(durationMs) : '';
            return '| ✓' + (stats.passed || 0) + ' | ✗' + failed + ' | ⭾ ' + (stats.skipped || 0) + ' | ● ' + stats.total + duration;
        }

        function formatDuration(durationMs) {
            if (durationMs < 1000) return durationMs.toFixed(1) + 'ms';
            return (durationMs / 1000).toFixed(1) + 's';
        }

        function titleFor(node) {
            const parts = [node.fqcn || node.packageName || node.label];
            if (node.methodName) parts.push(node.methodName);
            if (node.tags && node.tags.length) parts.push('@' + node.tags.join(' @'));
            if (node.isVirtual) parts.push('Virtual test, opens parent method');
            return parts.join('\\n');
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
