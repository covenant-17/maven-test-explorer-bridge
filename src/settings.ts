import * as vscode from 'vscode';
import {
    CONFIG_SECTION,
    CONFIG_MAVEN_EXECUTABLE,
    CONFIG_DEFAULT_COMMAND,
    CONFIG_DEFAULT_PROFILES,
    CONFIG_ADDITIONAL_ARGS,
    CONFIG_REPORT_GLOBS,
    CONFIG_WATCH_REPORTS,
    CONFIG_CLEAR_REPORTS_BEFORE_RUN,
    CONFIG_TEST_CLASS_COMMAND_TEMPLATE,
    CONFIG_TEST_METHOD_COMMAND_TEMPLATE,
    CONFIG_MULTI_MODULE_MODE,
    CONFIG_SHOW_OUTPUT_CHANNEL,
    SUREFIRE_GLOB,
    FAILSAFE_GLOB,
    DEFAULT_CLASS_TEMPLATE,
    DEFAULT_METHOD_TEMPLATE,
} from './constants';

export type MultiModuleMode = 'auto' | 'root' | 'perModule';

export interface ExtensionSettings {
    readonly mavenExecutable: string;
    readonly defaultCommand: string;
    readonly defaultProfiles: readonly string[];
    readonly additionalArgs: string;
    readonly reportGlobs: readonly string[];
    readonly watchReports: boolean;
    readonly clearReportsBeforeRun: boolean;
    readonly testClassCommandTemplate: string;
    readonly testMethodCommandTemplate: string;
    readonly multiModuleMode: MultiModuleMode;
    readonly showOutputChannel: boolean;
}

export function readSettings(): ExtensionSettings {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
        mavenExecutable: cfg.get<string>(CONFIG_MAVEN_EXECUTABLE, 'mvn'),
        defaultCommand: cfg.get<string>(CONFIG_DEFAULT_COMMAND, 'clean test'),
        defaultProfiles: cfg.get<string[]>(CONFIG_DEFAULT_PROFILES, []),
        additionalArgs: cfg.get<string>(CONFIG_ADDITIONAL_ARGS, ''),
        reportGlobs: cfg.get<string[]>(CONFIG_REPORT_GLOBS, [SUREFIRE_GLOB, FAILSAFE_GLOB]),
        watchReports: cfg.get<boolean>(CONFIG_WATCH_REPORTS, true),
        clearReportsBeforeRun: cfg.get<boolean>(CONFIG_CLEAR_REPORTS_BEFORE_RUN, true),
        testClassCommandTemplate: cfg.get<string>(CONFIG_TEST_CLASS_COMMAND_TEMPLATE, DEFAULT_CLASS_TEMPLATE),
        testMethodCommandTemplate: cfg.get<string>(CONFIG_TEST_METHOD_COMMAND_TEMPLATE, DEFAULT_METHOD_TEMPLATE),
        multiModuleMode: cfg.get<MultiModuleMode>(CONFIG_MULTI_MODULE_MODE, 'auto'),
        showOutputChannel: cfg.get<boolean>(CONFIG_SHOW_OUTPUT_CHANNEL, true),
    };
}
