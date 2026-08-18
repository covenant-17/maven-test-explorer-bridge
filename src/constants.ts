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
export const CONFIG_SHOW_OUTPUT_CHANNEL = 'showOutputChannel';
export const CONFIG_AUTO_REFRESH_ON_SAVE = 'autoRefreshOnSave';
export const CONFIG_AUTO_REFRESH_DEBOUNCE_MS = 'autoRefreshDebounceMs';
export const CONFIG_MAX_HISTORY_ENTRIES = 'maxHistoryEntries';
export const CONFIG_RUN_HISTORY_ENABLED = 'runHistoryEnabled';
export const CONFIG_TEST_SOURCE_GLOBS = 'testSourceGlobs';
export const CONFIG_PREFER_MAVEN_WRAPPER = 'preferMavenWrapper';

// Command IDs
export const CMD_REFRESH_TESTS = 'mavenTestExplorer.refreshTests';
export const CMD_RUN_ALL_TESTS = 'mavenTestExplorer.runAllTests';
export const CMD_STOP_RUN = 'mavenTestExplorer.stopRun';
export const CMD_EXPAND_ALL = 'mavenTestExplorer.expandAll';
export const CMD_COLLAPSE_ALL = 'mavenTestExplorer.collapseAll';
export const CMD_SORT_BY_LOCATION = 'mavenTestExplorer.sortByLocation';
export const CMD_SORT_BY_NAME = 'mavenTestExplorer.sortByName';
export const CMD_SORT_BY_STATUS = 'mavenTestExplorer.sortByStatus';
export const CMD_SORT_BY_DURATION = 'mavenTestExplorer.sortByDuration';
export const CMD_SORT_BY_LOCATION_ASC = 'mavenTestExplorer.sortByLocationAsc';
export const CMD_SORT_BY_LOCATION_DESC = 'mavenTestExplorer.sortByLocationDesc';
export const CMD_SORT_BY_NAME_ASC = 'mavenTestExplorer.sortByNameAsc';
export const CMD_SORT_BY_NAME_DESC = 'mavenTestExplorer.sortByNameDesc';
export const CMD_SORT_BY_STATUS_ASC = 'mavenTestExplorer.sortByStatusAsc';
export const CMD_SORT_BY_STATUS_DESC = 'mavenTestExplorer.sortByStatusDesc';
export const CMD_SORT_BY_DURATION_ASC = 'mavenTestExplorer.sortByDurationAsc';
export const CMD_SORT_BY_DURATION_DESC = 'mavenTestExplorer.sortByDurationDesc';
export const CMD_SHOW_TREE_VIEW = 'mavenTestExplorer.showTreeView';
export const CMD_SHOW_LIST_VIEW = 'mavenTestExplorer.showListView';
export const CMD_RERUN_FAILED = 'mavenTestExplorer.rerunFailed';
export const CMD_CLEAN_REPORTS = 'mavenTestExplorer.cleanReports';
export const CMD_CLEAR_RESULTS = 'mavenTestExplorer.clearResults';
export const CMD_CLEAR_RESULTS_AND_HISTORY = 'mavenTestExplorer.clearResultsAndHistory';
export const CMD_SHOW_HISTORY = 'mavenTestExplorer.showHistory';
export const CMD_REVEAL_IN_CUSTOM_EXPLORER = 'mavenTestExplorer.revealInCustomExplorer';
export const CMD_CONFIGURE_TREE_PARTS = 'mavenTestExplorer.configureTreeVisibleParts';
export const CMD_CONFIGURE_LIST_PARTS = 'mavenTestExplorer.configureListVisibleParts';

// Glob patterns
export const POM_GLOB = '**/pom.xml';
export const JAVA_TEST_GLOB = '**/src/test/java/**/*.java';
export const SUREFIRE_GLOB = '**/target/surefire-reports/TEST-*.xml';
export const FAILSAFE_GLOB = '**/target/failsafe-reports/TEST-*.xml';

// Directory names
export const SUREFIRE_REPORTS_DIR = 'target/surefire-reports';
export const FAILSAFE_REPORTS_DIR = 'target/failsafe-reports';

// Output channel name
export const OUTPUT_CHANNEL_NAME = 'Maven Test Explorer';

// Run profile label
export const RUN_PROFILE_LABEL = 'Run via Maven';

// Default command templates
export const DEFAULT_CLASS_TEMPLATE = '{maven} {profiles} {args} -Dtest={className} test';
