export const EXTENSION_ID = 'mavenTestExplorer';
export const CONTROLLER_LABEL = 'Maven Test Explorer';

// Configuration keys
export const CONFIG_SECTION = 'mavenTestExplorer';
export const CONFIG_MAVEN_EXECUTABLE = 'mavenExecutable';
export const CONFIG_DEFAULT_COMMAND = 'defaultCommand';
export const CONFIG_DEFAULT_PROFILES = 'defaultProfiles';
export const CONFIG_ADDITIONAL_ARGS = 'additionalArgs';
export const CONFIG_REPORT_GLOBS = 'reportGlobs';
export const CONFIG_WATCH_REPORTS = 'watchReports';
export const CONFIG_CLEAR_REPORTS_BEFORE_RUN = 'clearReportsBeforeRun';
export const CONFIG_TEST_CLASS_COMMAND_TEMPLATE = 'testClassCommandTemplate';
export const CONFIG_TEST_METHOD_COMMAND_TEMPLATE = 'testMethodCommandTemplate';
export const CONFIG_MULTI_MODULE_MODE = 'multiModuleMode';
export const CONFIG_SHOW_OUTPUT_CHANNEL = 'showOutputChannel';
export const CONFIG_AUTO_REFRESH_ON_SAVE = 'autoRefreshOnSave';
export const CONFIG_AUTO_REFRESH_DEBOUNCE_MS = 'autoRefreshDebounceMs';
export const CONFIG_SHOW_STATS = 'showStats';
export const CONFIG_STATS_FORMAT = 'statsFormat';
export const CONFIG_MAX_HISTORY_ENTRIES = 'maxHistoryEntries';
export const CONFIG_RUN_HISTORY_ENABLED = 'runHistoryEnabled';
export const CONFIG_TEST_SOURCE_GLOBS = 'testSourceGlobs';
export const CONFIG_PREFER_MAVEN_WRAPPER = 'preferMavenWrapper';

export const DEFAULT_STATS_FORMAT = '| ✓{passed} | ✗{failed} | ⭾ {skipped} | ● {total} ';

// Command IDs
export const CMD_REFRESH_TESTS = 'mavenTestExplorer.refreshTests';
export const CMD_RUN_ALL_TESTS = 'mavenTestExplorer.runAllTests';
export const CMD_RERUN_FAILED = 'mavenTestExplorer.rerunFailed';
export const CMD_CLEAN_REPORTS = 'mavenTestExplorer.cleanReports';
export const CMD_COPY_MAVEN_COMMAND = 'mavenTestExplorer.copyMavenCommand';
export const CMD_COPY = 'mavenTestExplorer.copy';
export const CMD_COPY_ITEM_MAVEN_COMMAND = 'mavenTestExplorer.copyItemMavenCommand';
export const CMD_COPY_CLASS_NAME = 'mavenTestExplorer.copyClassName';
export const CMD_COPY_METHOD_NAME = 'mavenTestExplorer.copyMethodName';
export const CMD_COPY_PACKAGE_NAME = 'mavenTestExplorer.copyPackageName';
export const CMD_COPY_FULL_PATH = 'mavenTestExplorer.copyFullPath';
export const CMD_CLEAR_RESULTS = 'mavenTestExplorer.clearResults';
export const CMD_CLEAR_RESULTS_AND_HISTORY = 'mavenTestExplorer.clearResultsAndHistory';
export const CMD_SHOW_HISTORY = 'mavenTestExplorer.showHistory';
export const CMD_ATTACH_TO_COPILOT = 'mavenTestExplorer.attachToCopilot';
export const CMD_ATTACH_TO_CLAUDE = 'mavenTestExplorer.attachToClaude';
export const CMD_APPLY_FILTER = 'mavenTestExplorer.applyFilter';
export const CMD_CLEAR_FILTER = 'mavenTestExplorer.clearFilter';

// Glob patterns
export const POM_GLOB = '**/pom.xml';
export const JAVA_TEST_GLOB = '**/src/test/java/**/*.java';
export const SUREFIRE_GLOB = '**/target/surefire-reports/TEST-*.xml';
export const FAILSAFE_GLOB = '**/target/failsafe-reports/TEST-*.xml';

// Directory names
export const SUREFIRE_REPORTS_DIR = 'target/surefire-reports';
export const FAILSAFE_REPORTS_DIR = 'target/failsafe-reports';
export const TARGET_DIR = 'target';

// Output channel name
export const OUTPUT_CHANNEL_NAME = 'Maven Test Explorer';

// Run profile label
export const RUN_PROFILE_LABEL = 'Run via Maven';

// Watcher debounce delay in milliseconds
export const WATCHER_DEBOUNCE_MS = 500;

// Default command templates
export const DEFAULT_CLASS_TEMPLATE = '{maven} {profiles} {args} -Dtest={className} test';
export const DEFAULT_METHOD_TEMPLATE = '{maven} {profiles} {args} -Dtest={className}#{methodName} test';

// JUnit 5 annotation patterns
export const JUNIT_TEST_ANNOTATIONS = ['@Test', '@ParameterizedTest', '@RepeatedTest'];
