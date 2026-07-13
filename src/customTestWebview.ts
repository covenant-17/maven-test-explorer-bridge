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
        webviewView.webview.options = { enableScripts: true };
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
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maven Test Explorer</title>
    <style>
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
        }
        .toolbar {
            display: grid;
            grid-template-columns: 1fr auto auto auto auto;
            gap: 4px;
            padding: 6px;
            border-bottom: 1px solid var(--vscode-sideBar-border);
            background: var(--vscode-sideBar-background);
            position: sticky;
            top: 0;
            z-index: 2;
        }
        .filter {
            min-width: 0;
            height: 24px;
            padding: 2px 7px;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 2px;
            outline: none;
        }
        .filter:focus {
            border-color: var(--vscode-focusBorder);
        }
        button {
            width: 26px;
            height: 24px;
            padding: 0;
            color: var(--vscode-button-secondaryForeground);
            background: var(--vscode-button-secondaryBackground);
            border: 0;
            border-radius: 2px;
            cursor: pointer;
            font: inherit;
        }
        button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .summary {
            display: flex;
            gap: 8px;
            align-items: center;
            padding: 4px 8px;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-sideBar-border);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .error {
            padding: 4px 8px;
            color: var(--vscode-errorForeground);
            background: var(--vscode-inputValidation-errorBackground);
        }
        .tree {
            padding: 3px 0 8px;
        }
        .row {
            display: grid;
            grid-template-columns: calc(var(--depth) * var(--indent)) 16px 16px minmax(0, 1fr) auto auto;
            align-items: center;
            min-height: var(--row-height);
            line-height: var(--row-height);
            padding-right: 4px;
            user-select: none;
            cursor: default;
        }
        .row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .row.selected {
            color: var(--vscode-list-activeSelectionForeground);
            background: var(--vscode-list-activeSelectionBackground);
        }
        .twisty, .status, .kind {
            display: inline-flex;
            justify-content: center;
            align-items: center;
            width: 16px;
            height: 20px;
            color: var(--vscode-descriptionForeground);
        }
        .twisty.action {
            cursor: pointer;
        }
        .status.passed { color: var(--vscode-testing-iconPassed); }
        .status.failed, .status.error { color: var(--vscode-testing-iconFailed); }
        .status.skipped { color: var(--vscode-testing-iconSkipped); }
        .label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .description, .stats {
            color: var(--vscode-descriptionForeground);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-left: 6px;
        }
        .actions {
            display: none;
            gap: 2px;
        }
        .row:hover .actions, .row.selected .actions {
            display: flex;
        }
        .action-btn {
            width: 20px;
            height: 20px;
            color: var(--vscode-icon-foreground);
            background: transparent;
        }
        .empty {
            padding: 12px 8px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <input id="filter" class="filter" aria-label="Filter" placeholder="Filter (e.g. text, !exclude, @tag)">
        <button id="refresh" title="Refresh">R</button>
        <button id="runAll" title="Run All">▶</button>
        <button id="rerunFailed" title="Re-run Failed">F</button>
        <button id="history" title="History">H</button>
    </div>
    <div id="summary" class="summary"></div>
    <div id="filterError" class="error" hidden></div>
    <div id="tree" class="tree"></div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let state = { roots: [], stats: { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 }, expandedIds: [], running: false, filterText: '' };
        let filterTimer;

        const treeEl = document.getElementById('tree');
        const summaryEl = document.getElementById('summary');
        const filterEl = document.getElementById('filter');
        const errorEl = document.getElementById('filterError');

        document.getElementById('refresh').addEventListener('click', () => post('refresh'));
        document.getElementById('runAll').addEventListener('click', () => post('runAll'));
        document.getElementById('rerunFailed').addEventListener('click', () => post('rerunFailed'));
        document.getElementById('history').addEventListener('click', () => post('showHistory'));

        filterEl.addEventListener('input', () => {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => post('applyFilter', { value: filterEl.value }), 180);
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
            summaryEl.textContent = [
                state.running ? 'running' : 'idle',
                'passed ' + (stats.passed || 0),
                'failed ' + ((stats.failed || 0) + (stats.error || 0)),
                'skipped ' + (stats.skipped || 0),
                'total ' + (stats.total || 0),
            ].join('  ');
            if (state.filterError) {
                errorEl.hidden = false;
                errorEl.textContent = state.filterError;
            } else {
                errorEl.hidden = true;
                errorEl.textContent = '';
            }
            treeEl.textContent = '';
            const roots = state.roots || [];
            if (roots.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty';
                empty.textContent = 'No tests found';
                treeEl.appendChild(empty);
                return;
            }
            for (const node of roots) {
                renderNode(node, 0);
            }
        }

        function renderNode(node, depth) {
            const expanded = isExpanded(node.id);
            const hasChildren = node.children && node.children.length > 0;
            const row = document.createElement('div');
            row.className = 'row' + (state.selectedId === node.id ? ' selected' : '');
            row.style.setProperty('--depth', String(depth));
            row.title = titleFor(node);
            row.addEventListener('click', () => {
                post('selectNode', { id: node.id });
            });
            row.addEventListener('dblclick', () => {
                post('openNode', { id: node.id });
            });

            const indent = document.createElement('span');
            const twisty = document.createElement('span');
            twisty.className = 'twisty' + (hasChildren ? ' action' : '');
            twisty.textContent = hasChildren ? (expanded ? '▾' : '▸') : '';
            twisty.addEventListener('click', (event) => {
                event.stopPropagation();
                if (hasChildren) {
                    post('setExpanded', { id: node.id, expanded: !expanded });
                }
            });
            const status = document.createElement('span');
            status.className = 'status ' + (node.status || 'unknown');
            status.textContent = statusGlyph(node.status);
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = node.label;
            const description = document.createElement('span');
            description.className = 'description';
            description.textContent = node.description || '';
            const stats = document.createElement('span');
            stats.className = 'stats';
            stats.textContent = statsText(node.stats);

            const actions = document.createElement('span');
            actions.className = 'actions';
            actions.appendChild(iconButton('▶', 'Run', () => post('runNode', { id: node.id })));
            actions.appendChild(iconButton('↗', 'Open Source', () => post('openNode', { id: node.id })));
            actions.appendChild(iconButton('C', 'Copy Path', () => post('copy', { id: node.id, kind: 'path' })));

            row.append(indent, twisty, status, label, stats, actions);
            if (description.textContent) {
                label.appendChild(description);
            }
            treeEl.appendChild(row);

            if (hasChildren && expanded) {
                for (const child of node.children) {
                    renderNode(child, depth + 1);
                }
            }
        }

        function iconButton(text, title, onClick) {
            const button = document.createElement('button');
            button.className = 'action-btn';
            button.type = 'button';
            button.title = title;
            button.textContent = text;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                onClick();
            });
            return button;
        }

        function isExpanded(id) {
            return (state.expandedIds || []).includes(id);
        }

        function statusGlyph(status) {
            if (status === 'passed') return '✓';
            if (status === 'failed') return '×';
            if (status === 'error') return '!';
            if (status === 'skipped') return '-';
            return '';
        }

        function statsText(stats) {
            if (!stats || !stats.total) return '';
            const failed = (stats.failed || 0) + (stats.error || 0);
            return (stats.passed || 0) + '/' + stats.total + (failed ? ' failed ' + failed : '');
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
