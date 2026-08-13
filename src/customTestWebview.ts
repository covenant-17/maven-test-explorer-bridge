import * as vscode from 'vscode';
import { CustomNodeStats, CustomTestNode } from './customTestModel';

export const CUSTOM_VIEW_ID = 'mavenTestExplorer.view';

export interface WebviewState {
    roots: readonly CustomTestNode[];
    availableTags: readonly string[];
    availableAnnotations: readonly string[];
    filterFacets: readonly (readonly string[])[];
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
    runNodes(ids: readonly string[]): void | Promise<void>;
    selectNode(id: string): void | Promise<void>;
    setExpanded(id: string, expanded: boolean): void | Promise<void>;
    copy(kind: string, id?: string): void | Promise<void>;
    attach(kind: 'copilot' | 'claude', id?: string): void | Promise<void>;
}

export class CustomTestWebviewProvider implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;
    private state: WebviewState = {
        roots: [],
        availableTags: [],
        availableAnnotations: [],
        filterFacets: [],
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
            case 'runNodes':
                if (message.ids?.length) { await this.handlers.runNodes(message.ids); }
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
            --meta-width: 224px;
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
        .filter-help {
            cursor: help;
        }
        .filter-suggestions {
            position: absolute;
            z-index: 40;
            top: calc(100% + 2px);
            left: -1px;
            right: -1px;
            max-height: min(280px, calc(100vh - 64px));
            padding: 4px;
            color: var(--vscode-menu-foreground);
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
            box-shadow: 0 2px 8px var(--vscode-widget-shadow);
            overflow-y: auto;
        }
        .filter-suggestions[hidden] {
            display: none;
        }
        .filter-suggestion {
            width: 100%;
            height: 24px;
            display: flex;
            align-items: center;
            padding: 0 8px;
            color: inherit;
            background: transparent;
            border: 1px solid transparent;
            text-align: left;
            white-space: nowrap;
            cursor: pointer;
        }
        .filter-suggestion-label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .filter-suggestion-count {
            flex: 0 0 auto;
            margin-left: auto;
            padding-left: 12px;
            color: var(--vscode-descriptionForeground);
            font-variant-numeric: tabular-nums;
        }
        .filter-suggestion.active .filter-suggestion-count,
        .filter-suggestion:hover .filter-suggestion-count {
            color: inherit;
        }
        .filter-suggestion:hover,
        .filter-suggestion.active {
            color: var(--vscode-list-activeSelectionForeground, var(--vscode-menu-selectionForeground));
            background: var(--vscode-list-activeSelectionBackground, var(--vscode-menu-selectionBackground));
            border-color: var(--vscode-focusBorder);
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
        .codicon-go-to-file::before { content: "\\ea94"; }
        .codicon-event::before { content: "\\ea86"; }
        .codicon-root::before { content: "\\ea65"; }
        .codicon-type-hierarchy-sub::before { content: "\\ebba"; }
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
            line-height: 16px;
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
            height: 18px;
            line-height: 16px;
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
            height: 18px;
            line-height: 16px;
            overflow: hidden;
        }
        .summary-count {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            min-width: 0;
            height: 18px;
            line-height: 16px;
        }
        .summary .codicon {
            width: 14px;
            height: 14px;
            flex-basis: 14px;
            font-size: 14px;
            line-height: 14px;
            align-self: center;
        }
        .passed { color: var(--vscode-testing-iconPassed); }
        .failed { color: var(--vscode-testing-iconFailed); }
        .error { color: var(--vscode-testing-iconErrored, var(--vscode-testing-iconFailed)); }
        .skipped { color: var(--vscode-testing-iconSkipped); }
        .virtual-invocations { color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
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
            background: var(--vscode-tree-inactiveIndentGuidesStroke, var(--vscode-tree-indentGuidesStroke));
            opacity: 0;
            visibility: hidden;
        }
        .tree:hover .indent-guide:not(.active) {
            opacity: 0.52;
            visibility: visible;
        }
        .indent-guide.active {
            background: var(--vscode-tree-indentGuidesStroke, var(--vscode-focusBorder));
            opacity: 0.95;
            visibility: visible;
        }
        .twisty {
            width: 16px;
            height: var(--row-height);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 16px;
            color: var(--vscode-icon-foreground, var(--vscode-foreground));
            background: transparent;
            border: 0;
            padding: 0;
            cursor: pointer;
            opacity: 0.92;
        }
        .twisty:hover {
            opacity: 1;
        }
        .twisty.empty {
            cursor: default;
            opacity: 0;
        }
        .status {
            width: var(--status-width);
            flex-basis: var(--status-width);
            margin-right: 4px;
            font-size: 14px;
            line-height: 14px;
        }
        .status.running {
            width: 12px;
            height: 12px;
            flex-basis: 12px;
            margin-left: 1px;
            margin-right: 7px;
            border: 2px solid var(--vscode-progressBar-background, var(--vscode-focusBorder));
            border-top-color: transparent;
            border-radius: 50%;
            animation: node-spin 2400ms linear infinite;
        }
        .status.running::before {
            content: "";
        }
        @keyframes node-spin {
            to { transform: rotate(360deg); }
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
            max-width: min(70%, var(--meta-width));
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
        .right-meta > span {
            flex: 0 0 auto;
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
        }
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
            background: transparent;
        }
        .row:hover .actions,
        .row:focus-within .actions {
            opacity: 1;
            pointer-events: auto;
        }
        .row.selected .actions {
            background: transparent;
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
            padding: 4px;
            color: var(--vscode-menu-foreground);
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border, transparent);
            border-radius: 5px;
            box-shadow: 0 2px 8px var(--vscode-widget-shadow);
            overflow: hidden;
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
            padding: 0 10px;
            color: inherit;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 3px;
            text-align: left;
            white-space: nowrap;
            cursor: pointer;
        }
        .menu-item .menu-chevron {
            margin-left: auto;
        }
        .menu-separator {
            height: 1px;
            margin: 4px 5px;
            background: var(--vscode-menu-separatorBackground, var(--vscode-menu-border, var(--vscode-widget-border)));
        }
        .menu-item:focus-visible {
            outline: 0;
        }
        .menu-item:hover,
        .menu-item.active {
            color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
            background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, var(--vscode-menu-selectionBackground)));
            border-color: var(--vscode-focusBorder);
        }
        .node-tooltip {
            position: fixed;
            z-index: 30;
            max-width: min(420px, calc(100vw - 16px));
            padding: 8px 10px;
            color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
            background: var(--vscode-editorHoverWidget-background, var(--vscode-menu-background));
            border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-menu-border, transparent));
            box-shadow: 0 2px 8px var(--vscode-widget-shadow);
            font-size: 12px;
            line-height: 18px;
            white-space: normal;
            pointer-events: none;
        }
        .node-tooltip[hidden] {
            display: none;
        }
        .node-tooltip-line {
            overflow-wrap: anywhere;
        }
        .node-tooltip-line:first-child {
            color: var(--vscode-foreground);
            font-weight: 600;
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
                --meta-width: 164px;
                --action-zone: 28px;
            }
        }
    </style>
</head>
<body>
    <div class="test-explorer">
        <div class="filter-row">
            <div id="filterShell" class="filter-shell">
                <span id="filterHelp" class="codicon codicon-filter filter-help" role="img" tabindex="0" aria-label="Filter syntax help"></span>
                <input id="filter" class="filter" aria-label="Filter tests" placeholder="Filter tests (type @ for suggestions)">
                <button id="clearFilterButton" class="icon-button" type="button" aria-label="Clear Filter"><span class="codicon codicon-close"></span></button>
                <div id="filterSuggestions" class="filter-suggestions" role="listbox" hidden></div>
            </div>
        </div>
        <div id="summary" class="summary" aria-live="polite"></div>
        <div id="filterError" class="filter-error" hidden></div>
        <div class="tree-wrap">
            <div id="tree" class="tree" tabindex="0" role="tree" aria-label="Maven Test Explorer tree" aria-multiselectable="true" aria-activedescendant="">
                <div id="rows" class="rows"></div>
            </div>
        </div>
        <div id="copyMenu" class="menu" role="menu" hidden></div>
        <div id="copySubmenu" class="menu" role="menu" hidden></div>
        <div id="nodeTooltip" class="node-tooltip" hidden></div>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const ROW_HEIGHT = 22;
        const TOOLTIP_LINE_BREAK = String.fromCharCode(10);
        const TOOLTIP_DELAY_MS = 1000;
        const SYSTEM_FILTERS = ['@failed', '@executed'];
        let state = { roots: [], availableTags: [], availableAnnotations: [], filterFacets: [], stats: { passed: 0, failed: 0, error: 0, skipped: 0, total: 0 }, expandedIds: [], running: false, filterText: '' };
        let filterTimer;
        let filterSuggestionItems = [];
        let filterSuggestionIndex = -1;
        let suppressFilterSuggestions = true;
        let tooltipTimer;
        let tooltipOwnerId = null;
        let pendingTooltip;
        let flatRows = [];
        let activeGuideParentId;
        let menuItems = [];
        let menuIndex = -1;
        let menuNode = null;
        let selectedNodeIds = new Set();
        let selectionAnchorId = null;
        let submenuItems = [];
        let submenuIndex = -1;
        let submenuTrigger = null;

        const treeEl = document.getElementById('tree');
        let rowsEl = document.getElementById('rows');
        const summaryEl = document.getElementById('summary');
        const filterEl = document.getElementById('filter');
        const filterHelpEl = document.getElementById('filterHelp');
        const filterShellEl = document.getElementById('filterShell');
        const filterSuggestionsEl = document.getElementById('filterSuggestions');
        const errorEl = document.getElementById('filterError');
        const copyMenuEl = document.getElementById('copyMenu');
        const copySubmenuEl = document.getElementById('copySubmenu');
        const nodeTooltipEl = document.getElementById('nodeTooltip');
        const clearFilterButton = document.getElementById('clearFilterButton');

        const filterHelpText = [
            'Filter syntax',
            'Type @ to choose tags and annotations.',
            'Comma, AND, or && match all filters.',
            'OR or || matches any filter.',
            'annotation=value partially matches a value.',
            'annotation="value" exactly matches a value.',
        ].join(TOOLTIP_LINE_BREAK);
        filterHelpEl.addEventListener('mouseenter', () => scheduleNodeTooltip('filter-help', filterHelpText, filterHelpEl));
        filterHelpEl.addEventListener('mouseleave', () => hideNodeTooltip('filter-help'));
        filterHelpEl.addEventListener('focus', () => scheduleNodeTooltip('filter-help', filterHelpText, filterHelpEl));
        filterHelpEl.addEventListener('blur', () => hideNodeTooltip('filter-help'));
        withInternalTooltip(clearFilterButton, 'clear-filter', 'Clear Filter');

        clearFilterButton.addEventListener('click', () => {
            filterEl.value = '';
            suppressFilterSuggestions = true;
            hideFilterSuggestions();
            post('clearFilter');
            filterEl.focus();
        });

        filterEl.addEventListener('input', (event) => {
            clearTimeout(filterTimer);
            const typedAt = event.inputType === 'insertText' && event.data === '@';
            const token = filterTokenAtCursor();
            const typedAnnotationEquals = event.inputType === 'insertText'
                && event.data === '='
                && Boolean(annotationValueContext(token?.value));
            if (typedAt || typedAnnotationEquals) {
                suppressFilterSuggestions = false;
            }
            if (suppressFilterSuggestions || !token || !token.value.startsWith('@')) {
                suppressFilterSuggestions = true;
                hideFilterSuggestions();
            } else {
                renderFilterSuggestions();
            }
            filterTimer = setTimeout(() => post('applyFilter', { value: filterEl.value }), 180);
        });

        filterEl.addEventListener('keydown', (event) => {
            if (!filterSuggestionsEl.hidden && event.key === 'ArrowDown') {
                event.preventDefault();
                setFilterSuggestionIndex(Math.min(filterSuggestionIndex + 1, filterSuggestionItems.length - 1));
            } else if (!filterSuggestionsEl.hidden && event.key === 'ArrowUp') {
                event.preventDefault();
                setFilterSuggestionIndex(Math.max(filterSuggestionIndex - 1, 0));
            } else if (!filterSuggestionsEl.hidden && (event.key === 'Enter' || event.key === 'Tab')) {
                event.preventDefault();
                applyFilterSuggestion(filterSuggestionItems[Math.max(filterSuggestionIndex, 0)]?.dataset.value);
            } else if (!filterSuggestionsEl.hidden && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                suppressFilterSuggestions = true;
                hideFilterSuggestions();
            } else if (event.key === 'Escape' && filterEl.value) {
                event.stopPropagation();
                filterEl.value = '';
                suppressFilterSuggestions = true;
                post('clearFilter');
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusSelectedOrFirst();
            }
        });

        treeEl.addEventListener('keydown', handleTreeKeydown);
        treeEl.addEventListener('scroll', hideNodeTooltip);

        document.addEventListener('click', (event) => {
            if (!copyMenuEl.contains(event.target) && !copySubmenuEl.contains(event.target)) {
                hideCopyMenu();
            }
            if (!filterShellEl.contains(event.target)) {
                suppressFilterSuggestions = true;
                hideFilterSuggestions();
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'stateUpdated') {
                const previousTop = treeEl.scrollTop;
                state = message.state || state;
                const visibleIds = new Set(flattenRoots(state.roots || []).map(entry => entry.node.id));
                selectedNodeIds = new Set(Array.from(selectedNodeIds).filter(id => visibleIds.has(id)));
                if (selectedNodeIds.size === 0 && state.selectedId && visibleIds.has(state.selectedId)) {
                    selectedNodeIds.add(state.selectedId);
                }
                if (!selectionAnchorId && state.selectedId) {
                    selectionAnchorId = state.selectedId;
                }
                hideNodeTooltip();
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

        function renderFilterSuggestions() {
            if (suppressFilterSuggestions) {
                hideFilterSuggestions();
                return;
            }
            const token = filterTokenAtCursor();
            if (!token || !token.value.startsWith('@')) {
                hideFilterSuggestions();
                return;
            }
            const annotationContext = annotationValueContext(token.value);
            const suggestions = annotationContext
                ? annotationValueSuggestions(annotationContext)
                : filterNameSuggestions(token.value);
            filterSuggestionsEl.textContent = '';
            filterSuggestionItems = suggestions.map((suggestion, index) => {
                const item = document.createElement('button');
                item.className = 'filter-suggestion';
                item.type = 'button';
                item.dataset.value = suggestion.value;
                item.setAttribute('role', 'option');
                item.append(
                    textSpan(suggestion.label, 'filter-suggestion-label'),
                    textSpan(String(contextualFilterCount(suggestion.value)), 'filter-suggestion-count'),
                );
                item.addEventListener('mouseenter', () => setFilterSuggestionIndex(index));
                item.addEventListener('mousedown', event => event.preventDefault());
                item.addEventListener('click', () => applyFilterSuggestion(suggestion.value));
                filterSuggestionsEl.appendChild(item);
                return item;
            });
            filterSuggestionsEl.hidden = filterSuggestionItems.length === 0;
            setFilterSuggestionIndex(filterSuggestionItems.length > 0 ? 0 : -1);
        }

        function filterNameSuggestions(tokenValue) {
            const prefix = tokenValue.toLocaleLowerCase();
            const projectTags = (state.availableTags || []).map(tag => '@' + tag);
            const projectAnnotations = (state.availableAnnotations || []).map(annotation => '@' + annotation);
            return [...projectTags, ...SYSTEM_FILTERS, ...projectAnnotations]
                .filter((value, index, values) => values.indexOf(value) === index)
                .filter(value => filterSuggestionMatches(value, prefix))
                .map(value => ({ label: value, value }));
        }

        function annotationValueContext(tokenValue) {
            if (!tokenValue) return undefined;
            const equalsIndex = tokenValue.indexOf('=');
            if (equalsIndex < 0) return undefined;
            const key = tokenValue.substring(0, equalsIndex);
            if (!key.toLocaleLowerCase().includes('.annotation.')) return undefined;
            let query = tokenValue.substring(equalsIndex + 1);
            if (query.startsWith('"')) query = query.substring(1);
            if (query.endsWith('"')) query = query.substring(0, query.length - 1);
            return { key, query: query.toLocaleLowerCase() };
        }

        function annotationValueSuggestions(context) {
            const facetPrefix = context.key.toLocaleLowerCase() + '=';
            const values = new Set();
            (state.filterFacets || []).forEach(facet => {
                facet.forEach(entry => {
                    if (entry.toLocaleLowerCase().startsWith(facetPrefix)) {
                        values.add(entry.substring(context.key.length + 1));
                    }
                });
            });
            return Array.from(values)
                .filter(value => value.toLocaleLowerCase().includes(context.query))
                .sort((left, right) => left.localeCompare(right))
                .map(value => ({
                    label: value,
                    value: context.key + '="' + value + '"',
                }));
        }

        function filterSuggestionMatches(value, prefix) {
            const normalized = value.toLocaleLowerCase();
            if (normalized.startsWith(prefix)) {
                return true;
            }
            if (!prefix.includes('.')) {
                const tagName = normalized.substring(normalized.lastIndexOf('.') + 1);
                return ('@' + tagName).startsWith(prefix);
            }
            return false;
        }

        function contextualFilterCount(candidate) {
            const token = filterTokenAtCursor();
            if (!token) return 0;
            const contextValue = filterEl.value.substring(0, token.start)
                + filterEl.value.substring(token.end);
            const selectedFilters = contextValue
                .split(',')
                .map(value => value.trim())
                .filter(value => value.startsWith('@'));
            const requiredFilters = [...selectedFilters, candidate];
            return (state.filterFacets || []).filter(facet => (
                requiredFilters.every(value => filterFacetMatches(facet, value))
            )).length;
        }

        function filterFacetMatches(facet, value) {
            const normalized = value.toLocaleLowerCase();
            return facet.some(entry => {
                const normalizedEntry = entry.toLocaleLowerCase();
                if (normalizedEntry === normalized) {
                    return true;
                }
                if (normalized.includes('.annotation.')) {
                    const equalsIndex = normalized.indexOf('=');
                    const key = equalsIndex >= 0 ? normalized.substring(0, equalsIndex) : normalized;
                    if (!normalizedEntry.startsWith(key + '=')) {
                        return false;
                    }
                    if (equalsIndex < 0) {
                        return true;
                    }
                    const expectedValue = normalized.substring(equalsIndex + 1);
                    const actualValue = normalizedEntry.substring(key.length + 1);
                    const exact = expectedValue.length >= 2
                        && expectedValue.startsWith('"')
                        && expectedValue.endsWith('"');
                    const expected = exact
                        ? expectedValue.substring(1, expectedValue.length - 1)
                        : expectedValue;
                    return exact ? actualValue === expected : actualValue.includes(expected);
                }
                if (!normalized.includes('.')) {
                    const tagName = normalizedEntry.substring(normalizedEntry.lastIndexOf('.') + 1);
                    return '@' + tagName === normalized;
                }
                return false;
            });
        }

        function filterTokenAtCursor() {
            const value = filterEl.value;
            const cursor = filterEl.selectionStart ?? value.length;
            let start = 0;
            let end = cursor;
            let inQuotes = false;
            for (let index = 0; index < cursor; index++) {
                if (value[index] === '"' && value[index - 1] !== '\\\\') {
                    inQuotes = !inQuotes;
                } else if (!inQuotes && /[\\s(),]/.test(value[index])) {
                    start = index + 1;
                }
            }
            while (end < value.length) {
                if (value[end] === '"' && value[end - 1] !== '\\\\') {
                    inQuotes = !inQuotes;
                } else if (!inQuotes && /[\\s(),]/.test(value[end])) {
                    break;
                }
                end++;
            }
            return { start, end, value: value.substring(start, cursor) };
        }

        function applyFilterSuggestion(value) {
            if (!value) return;
            const token = filterTokenAtCursor();
            if (!token) return;
            const before = filterEl.value.substring(0, token.start);
            const after = filterEl.value.substring(token.end);
            filterEl.value = before + value + after;
            const cursor = before.length + value.length;
            filterEl.setSelectionRange(cursor, cursor);
            suppressFilterSuggestions = true;
            hideFilterSuggestions();
            clearTimeout(filterTimer);
            post('applyFilter', { value: filterEl.value });
            filterEl.focus();
        }

        function setFilterSuggestionIndex(index) {
            filterSuggestionIndex = index;
            filterSuggestionItems.forEach((item, itemIndex) => {
                const active = itemIndex === index;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            filterSuggestionItems[index]?.scrollIntoView({ block: 'nearest' });
        }

        function hideFilterSuggestions() {
            filterSuggestionsEl.hidden = true;
            filterSuggestionsEl.textContent = '';
            filterSuggestionItems = [];
            filterSuggestionIndex = -1;
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
                summaryTotal(total),
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
            const rerunButton = rowAction('codicon-refresh', 'Re-run Failed Tests', () => post('rerunFailed'));
            right.appendChild(withInternalTooltip(rerunButton, 'rerun-failed', 'Re-run Failed Tests'));
            summaryEl.append(left, right);
        }

        function summaryCount(kind, label, value) {
            const item = document.createElement('span');
            item.className = 'summary-count';
            item.append(iconSpan(statusIcon(kind), kind), textSpan(String(value)));
            return withInternalTooltip(item, 'summary-' + kind, label + ': ' + value);
        }

        function summaryTotal(value) {
            const item = textSpan('of ' + value + ' tests', 'summary-group');
            return withInternalTooltip(item, 'summary-total', 'Total: ' + value);
        }

        function withInternalTooltip(element, ownerId, text) {
            element.addEventListener('mouseenter', () => scheduleNodeTooltip(ownerId, text, element));
            element.addEventListener('mouseleave', () => hideNodeTooltip(ownerId));
            return element;
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
            activeGuideParentId = findParentId(state.roots || [], state.selectedId);

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
                flattenNode(node, 0, output, []);
            }
            return output;
        }

        function flattenNode(node, depth, output, ancestorIds) {
            output.push({ node, depth, ancestorIds });
            if (!isExpanded(node.id)) {
                return;
            }
            for (const child of node.children || []) {
                flattenNode(child, depth + 1, output, [...ancestorIds, node.id]);
            }
        }

        function findParentId(roots, selectedId) {
            if (!selectedId) {
                return undefined;
            }
            const path = findNodePath(roots, selectedId, []);
            return path.length > 1 ? path[path.length - 2].id : undefined;
        }

        function findNodePath(nodes, selectedId, path) {
            for (const node of nodes || []) {
                const nextPath = [...path, node];
                if (node.id === selectedId) {
                    return nextPath;
                }
                const childPath = findNodePath(node.children || [], selectedId, nextPath);
                if (childPath.length) {
                    return childPath;
                }
            }
            return [];
        }

        function renderNode(entry, index) {
            const node = entry.node;
            const depth = entry.depth;
            const expanded = isExpanded(node.id);
            const hasChildren = Boolean(node.children && node.children.length > 0);
            const selected = selectedNodeIds.has(node.id);
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
            const tooltip = titleFor(node);
            row.setAttribute('aria-label', tooltip.split(TOOLTIP_LINE_BREAK).join('. '));
            row.addEventListener('mouseenter', () => scheduleNodeTooltip(node.id, tooltip, row));
            row.addEventListener('mouseleave', () => hideNodeTooltip(node.id));
            row.addEventListener('focus', () => scheduleNodeTooltip(node.id, tooltip, row));
            row.addEventListener('blur', () => hideNodeTooltip(node.id));

            for (let i = 0; i < depth; i++) {
                const guide = document.createElement('span');
                const active = entry.ancestorIds[i] === activeGuideParentId;
                guide.className = 'indent-guide' + (active ? ' active' : '');
                guide.style.left = (16 + i * 8) + 'px';
                row.appendChild(guide);
            }

            const twisty = document.createElement('button');
            twisty.className = 'twisty codicon ' + (hasChildren ? (expanded ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'codicon-empty empty');
            twisty.type = 'button';
            twisty.tabIndex = -1;
            twisty.style.marginLeft = (8 + depth * 8) + 'px';
            if (hasChildren) {
                twisty.setAttribute('aria-label', expanded ? 'Collapse' : 'Expand');
            }
            twisty.setAttribute('aria-hidden', hasChildren ? 'false' : 'true');
            twisty.addEventListener('click', (event) => {
                event.stopPropagation();
                if (hasChildren) {
                    selectNode(node.id);
                    post('setExpanded', { id: node.id, expanded: !expanded });
                }
            });

            const virtualInvocations = Boolean(node.hasVirtualInvocations);
            const statusIconClass = node.running
                ? 'codicon-empty'
                : (virtualInvocations ? 'codicon-type-hierarchy-sub' : statusIcon(node.status));
            const statusClass = node.running
                ? 'running'
                : (virtualInvocations ? 'virtual-invocations' : (node.status || 'unknown'));
            const status = iconSpan(statusIconClass, 'status ' + statusClass);
            if (virtualInvocations) {
                status.setAttribute('aria-label', 'Results are in generated test cases');
            }
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
            const runButton = rowAction('codicon-run', 'Run Test', () => post('runNode', { id: node.id }));
            const copyButton = rowAction('codicon-copy', 'Copy...', (event) => {
                selectNode(node.id);
                showCopyMenu(node, event.clientX, event.clientY);
            });
            actions.append(runButton, copyButton);

            row.append(twisty, status, label, rightMeta, actions);
            row.addEventListener('click', (event) => {
                hideCopyMenu();
                if (event.ctrlKey || event.metaKey) {
                    selectNode(node.id, 'toggle');
                    return;
                }
                if (event.shiftKey) {
                    selectNode(node.id, 'range');
                    return;
                }
                selectNode(node.id);
                if (hasChildren) {
                    post('setExpanded', { id: node.id, expanded: !expanded });
                } else if (isLeafSourceMethod(node)) {
                    post('openNode', { id: node.id });
                }
            });
            row.addEventListener('dblclick', () => {
                post('openNode', { id: node.id });
            });
            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                if (!selectedNodeIds.has(node.id)) {
                    selectNode(node.id);
                }
                showNodeContextMenu(node, event.clientX, event.clientY);
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
                const duration = totalDurationForNode(node);
                if (duration !== undefined) {
                    container.appendChild(textSpan(formatDuration(duration), 'duration'));
                }
                appendMetaPart(container, stats.passed || 0, 'passed');
                appendMetaPart(container, stats.failed || 0, 'failed');
                appendMetaPart(container, stats.error || 0, 'error');
                appendMetaPart(container, stats.skipped || 0, 'skipped');
                const total = textSpan('#' + String(stats.total), 'meta-total');
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
            const span = textSpan(metaPrefix(kind) + String(value), 'meta-' + kind);
            container.appendChild(span);
        }

        function metaPrefix(kind) {
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
            button.setAttribute('aria-label', title);
            button.tabIndex = -1;
            button.appendChild(iconSpan(iconClass));
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                onClick(event);
            });
            return button;
        }

        function scheduleNodeTooltip(ownerId, text, anchorEl) {
            if (tooltipOwnerId === ownerId && !nodeTooltipEl.hidden) {
                return;
            }
            clearTimeout(tooltipTimer);
            pendingTooltip = { ownerId, text, anchorEl };
            tooltipTimer = setTimeout(() => {
                if (!pendingTooltip || pendingTooltip.ownerId !== ownerId) {
                    return;
                }
                showNodeTooltip(ownerId, pendingTooltip.text, pendingTooltip.anchorEl);
            }, TOOLTIP_DELAY_MS);
        }

        function showNodeTooltip(ownerId, text, anchorEl) {
            clearTimeout(tooltipTimer);
            tooltipOwnerId = ownerId;
            pendingTooltip = null;
            nodeTooltipEl.textContent = '';
            for (const line of String(text).split(TOOLTIP_LINE_BREAK)) {
                const item = document.createElement('div');
                item.className = 'node-tooltip-line';
                item.textContent = line;
                nodeTooltipEl.appendChild(item);
            }
            nodeTooltipEl.hidden = false;
            const margin = 8;
            const anchorRect = anchorEl.getBoundingClientRect();
            const gap = 10;
            const maxLeft = window.innerWidth - nodeTooltipEl.offsetWidth - margin;
            const aboveTop = anchorRect.top - nodeTooltipEl.offsetHeight - gap;
            const belowTop = anchorRect.bottom + gap;
            const top = aboveTop >= margin
                ? aboveTop
                : Math.min(belowTop, window.innerHeight - nodeTooltipEl.offsetHeight - margin);
            const left = anchorRect.left + Math.max(0, (anchorRect.width - nodeTooltipEl.offsetWidth) / 2);
            nodeTooltipEl.style.left = Math.max(margin, Math.min(left, maxLeft)) + 'px';
            nodeTooltipEl.style.top = Math.max(margin, top) + 'px';
        }

        function hideNodeTooltip(ownerId) {
            if (ownerId && tooltipOwnerId && tooltipOwnerId !== ownerId) {
                return;
            }
            clearTimeout(tooltipTimer);
            pendingTooltip = null;
            tooltipOwnerId = null;
            nodeTooltipEl.hidden = true;
            nodeTooltipEl.textContent = '';
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
                showNodeContextMenu(node, rect.left + 24, rect.top + ROW_HEIGHT);
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

        function selectNode(id, mode = 'replace') {
            if (mode === 'toggle') {
                if (selectedNodeIds.has(id) && selectedNodeIds.size > 1) {
                    selectedNodeIds.delete(id);
                } else {
                    selectedNodeIds.add(id);
                }
                selectionAnchorId = id;
            } else if (mode === 'range' && selectionAnchorId) {
                const anchorIndex = flatRows.findIndex(entry => entry.node.id === selectionAnchorId);
                const targetIndex = flatRows.findIndex(entry => entry.node.id === id);
                if (anchorIndex >= 0 && targetIndex >= 0) {
                    const start = Math.min(anchorIndex, targetIndex);
                    const end = Math.max(anchorIndex, targetIndex);
                    selectedNodeIds = new Set(flatRows.slice(start, end + 1).map(entry => entry.node.id));
                }
            } else {
                selectedNodeIds = new Set([id]);
                selectionAnchorId = id;
            }
            const activeId = selectedNodeIds.has(id)
                ? id
                : Array.from(selectedNodeIds)[selectedNodeIds.size - 1];
            if (activeId && state.selectedId !== activeId) {
                state = { ...state, selectedId: activeId };
                post('selectNode', { id: activeId });
            }
            updateSelectedRows();
        }

        function updateSelectedRows() {
            activeGuideParentId = findParentId(state.roots || [], state.selectedId);
            for (const row of rowsEl.querySelectorAll('.row')) {
                const entry = flatRows.find(candidate => row.id === rowDomId(candidate.node.id));
                const selected = Boolean(entry && selectedNodeIds.has(entry.node.id));
                row.classList.toggle('selected', selected);
                row.classList.toggle('focused', Boolean(entry && entry.node.id === state.selectedId));
                row.setAttribute('aria-selected', selected ? 'true' : 'false');
            }
            updateIndentGuides();
            updateActiveDescendant();
        }

        function updateIndentGuides() {
            flatRows.forEach((entry) => {
                const row = document.getElementById(rowDomId(entry.node.id));
                if (!row) {
                    return;
                }
                row.querySelectorAll('.indent-guide').forEach((guide, index) => {
                    guide.classList.toggle('active', entry.ancestorIds[index] === activeGuideParentId);
                });
            });
        }

        function updateActiveDescendant() {
            if (state.selectedId) {
                treeEl.setAttribute('aria-activedescendant', rowDomId(state.selectedId));
            } else {
                treeEl.removeAttribute('aria-activedescendant');
            }
        }

        function showCopyMenu(node, x, y) {
            hideNodeTooltip();
            hideCopyMenu();
            menuNode = node;
            menuItems = renderCopyItems(copyMenuEl, node, false);
            if (menuItems.length === 0) {
                return;
            }
            positionMenu(copyMenuEl, x, y);
            setMenuIndex(0);
            copyMenuEl.addEventListener('keydown', handleMenuKeydown);
            menuItems[0].focus();
        }

        function showNodeContextMenu(node, x, y) {
            hideNodeTooltip();
            hideCopyMenu();
            menuNode = node;
            const runIds = selectedNodeIds.has(node.id)
                ? Array.from(selectedNodeIds)
                : [node.id];
            const runItem = menuItem('codicon-run', runIds.length > 1 ? 'Run Tests' : 'Run Test');
            runItem.addEventListener('click', (event) => {
                event.stopPropagation();
                if (runIds.length > 1) {
                    post('runNodes', { ids: runIds });
                } else {
                    post('runNode', { id: runIds[0] });
                }
                hideCopyMenu();
            });
            copyMenuEl.appendChild(runItem);
            menuItems.push(runItem);
            if (canGoToTest(node)) {
                appendMenuSeparator(copyMenuEl);
                const goToItem = menuItem('codicon-go-to-file', 'Go to Test');
                goToItem.addEventListener('click', (event) => {
                    event.stopPropagation();
                    post('openNode', { id: node.id });
                    hideCopyMenu();
                });
                copyMenuEl.appendChild(goToItem);
                menuItems.push(goToItem);
            }
            if (copyOptions(node).length > 0) {
                appendMenuSeparator(copyMenuEl);
                const copyItem = menuItem('codicon-copy', 'Copy...');
                copyItem.appendChild(iconSpan('codicon-chevron-right', 'menu-chevron'));
                copyItem.addEventListener('mouseenter', () => showCopySubmenu(node, copyItem));
                copyItem.addEventListener('click', (event) => {
                    event.stopPropagation();
                    showCopySubmenu(node, copyItem);
                    setSubmenuIndex(0);
                });
                copyMenuEl.appendChild(copyItem);
                menuItems.push(copyItem);
                submenuTrigger = copyItem;
            }
            menuItems.forEach((item, index) => {
                item.addEventListener('mouseenter', () => {
                    setMenuIndex(index);
                    if (item !== submenuTrigger) hideCopySubmenu();
                });
            });
            if (menuItems.length === 0) return;
            positionMenu(copyMenuEl, x, y);
            setMenuIndex(0);
            copyMenuEl.addEventListener('keydown', handleMenuKeydown);
            menuItems[0].focus();
        }

        function showCopySubmenu(node, anchorEl) {
            hideCopySubmenu();
            copySubmenuEl.textContent = '';
            submenuItems = renderCopyItems(copySubmenuEl, node, true);
            if (submenuItems.length === 0) return;
            copySubmenuEl.hidden = false;
            const anchor = anchorEl.getBoundingClientRect();
            const menuWidth = copySubmenuEl.offsetWidth;
            const preferredLeft = anchor.right + 2;
            const left = preferredLeft + menuWidth <= window.innerWidth - 4
                ? preferredLeft
                : anchor.left - menuWidth - 2;
            const maxTop = window.innerHeight - copySubmenuEl.offsetHeight - 4;
            copySubmenuEl.style.left = Math.max(4, left) + 'px';
            copySubmenuEl.style.top = Math.max(4, Math.min(anchor.top - 4, maxTop)) + 'px';
            copySubmenuEl.addEventListener('keydown', handleSubmenuKeydown);
        }

        function renderCopyItems(container, node, isSubmenu) {
            return copyOptions(node).map(([kind, label], index) => {
                const item = menuItem('codicon-copy', label);
                item.addEventListener('mouseenter', () => {
                    if (isSubmenu) setSubmenuIndex(index);
                    else setMenuIndex(index);
                });
                item.addEventListener('click', (event) => {
                    event.stopPropagation();
                    post('copy', { id: node.id, kind });
                    hideCopyMenu();
                });
                container.appendChild(item);
                return item;
            });
        }

        function menuItem(iconClass, label) {
            const item = document.createElement('button');
            item.className = 'menu-item';
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.append(iconSpan(iconClass), textSpan(label));
            return item;
        }

        function appendMenuSeparator(container) {
            const separator = document.createElement('div');
            separator.className = 'menu-separator';
            separator.setAttribute('role', 'separator');
            container.appendChild(separator);
        }

        function positionMenu(element, x, y) {
            element.hidden = false;
            const maxLeft = window.innerWidth - element.offsetWidth - 4;
            const maxTop = window.innerHeight - element.offsetHeight - 4;
            element.style.left = Math.max(4, Math.min(x, maxLeft)) + 'px';
            element.style.top = Math.max(4, Math.min(y, maxTop)) + 'px';
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
            } else if (event.key === 'ArrowRight' && menuItems[menuIndex] === submenuTrigger) {
                event.preventDefault();
                showCopySubmenu(menuNode, submenuTrigger);
                setSubmenuIndex(0);
            } else if ((event.key === 'Enter' || event.key === ' ') && menuItems[menuIndex]) {
                event.preventDefault();
                menuItems[menuIndex].click();
            }
        }

        function handleSubmenuKeydown(event) {
            if (event.key === 'Escape' || event.key === 'ArrowLeft') {
                event.preventDefault();
                hideCopySubmenu();
                submenuTrigger?.focus();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSubmenuIndex((submenuIndex + 1) % submenuItems.length);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSubmenuIndex((submenuIndex - 1 + submenuItems.length) % submenuItems.length);
            } else if ((event.key === 'Enter' || event.key === ' ') && submenuItems[submenuIndex]) {
                event.preventDefault();
                submenuItems[submenuIndex].click();
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

        function setSubmenuIndex(index) {
            submenuIndex = index;
            submenuItems.forEach((item, itemIndex) => {
                item.classList.toggle('active', itemIndex === submenuIndex);
                item.tabIndex = itemIndex === submenuIndex ? 0 : -1;
            });
            submenuItems[submenuIndex]?.focus();
        }

        function hideCopySubmenu() {
            copySubmenuEl.hidden = true;
            copySubmenuEl.textContent = '';
            copySubmenuEl.removeEventListener('keydown', handleSubmenuKeydown);
            submenuItems = [];
            submenuIndex = -1;
        }

        function hideCopyMenu() {
            hideCopySubmenu();
            copyMenuEl.hidden = true;
            copyMenuEl.textContent = '';
            copyMenuEl.removeEventListener('keydown', handleMenuKeydown);
            menuItems = [];
            menuIndex = -1;
            menuNode = null;
            submenuTrigger = null;
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

        function canGoToTest(node) {
            return Boolean(node.sourcePath)
                && (node.kind === 'class' || node.kind === 'method' || node.kind === 'virtualMethod' || node.kind === 'lifecycle');
        }

        function isLeafSourceMethod(node) {
            const hasChildren = Boolean(node.children && node.children.length > 0);
            return !hasChildren && (node.kind === 'method' || node.kind === 'virtualMethod' || node.kind === 'lifecycle');
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
            const stats = statsForTooltip(node);
            const duration = totalDurationForNode(node);
            const lines = [
                fullNameForTooltip(node),
                'Passed: ' + stats.passed + ' | Failed: ' + stats.failed + ' | Error: ' + stats.error + ' | Skipped: ' + stats.skipped + ' | Total: ' + stats.total,
                'Duration: ' + (duration !== undefined ? formatDuration(duration) : 'not run'),
            ];
            if (node.hasVirtualInvocations) {
                lines.push('Results are in generated test cases');
            }
            return lines.join(TOOLTIP_LINE_BREAK);
        }

        function fullNameForTooltip(node) {
            const baseName = node.fqcn || node.packageName || node.label;
            if (node.methodName && node.fqcn) {
                return node.fqcn + '#' + node.methodName;
            }
            return baseName;
        }

        function statsForTooltip(node) {
            const stats = node.stats;
            if (stats && stats.total) {
                return {
                    passed: stats.passed || 0,
                    failed: stats.failed || 0,
                    error: stats.error || 0,
                    skipped: stats.skipped || 0,
                    total: stats.total || 0,
                };
            }
            const status = node.status;
            const known = status === 'passed' || status === 'failed' || status === 'error' || status === 'skipped';
            return {
                passed: status === 'passed' ? 1 : 0,
                failed: status === 'failed' ? 1 : 0,
                error: status === 'error' ? 1 : 0,
                skipped: status === 'skipped' ? 1 : 0,
                total: known ? 1 : 0,
            };
        }
    </script>
</body>
</html>`;
    }
}

interface WebviewMessage {
    type: string;
    id?: string;
    ids?: string[];
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
