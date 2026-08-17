<p align="center">
  <img src="icon-17-128.png" width="96" alt="Maven Test Explorer Bridge" />
</p>

# Maven Test Explorer Bridge

> Bridge between **Maven/Surefire** and the **VS Code Testing sidebar** — no Microsoft Java Test Runner required.

[![Version](https://img.shields.io/badge/version-1.0.5-brightgreen)](CHANGELOG.md)
[![VS Code Engine](https://img.shields.io/badge/vscode-%5E1.84.0-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why?

When tests are run via **Maven** (from a terminal, a CI pipeline, or an AI agent like Claude Code), the VS Code Testing sidebar stays silent — it simply doesn't know what happened.

This extension fixes that. It discovers Maven tests, watches `target/surefire-reports/TEST-*.xml`, and renders the results in its dedicated Maven Test Explorer view in the Testing sidebar.

**Maven runs the tests. VS Code shows the results. That's it.**

---

## Features

- **Auto-discovery** — finds all Maven modules and JUnit 5 test classes in the workspace
- **Dedicated test tree and list** — switch between hierarchical and flat views with deterministic ordering, project grouping, and native run progress
- **Responsive large suites** — virtualized rendering keeps projects with thousands of tests fast to expand, scroll, select, and navigate; long names yield space to keep result statistics visible
- **Live sync** — detects Surefire/Failsafe XML changes and updates the sidebar without any manual action
- **Full JUnit 5 support** — `@Test`, `@ParameterizedTest`, `@RepeatedTest`, `@Nested` (including deeply nested classes), dynamic invocations, and inherited test-interface methods
- **Run from UI** — run all tests, a single class, or a single method via Maven directly from Test Explorer; multi-selection supported
- **Aggregate stats** — the header and expandable nodes show compact passed, failed, errored, skipped, and total counts at a glance
- **Run History** — last 20 runs stored per workspace; restore any previous result set with one click
- **Clear Results** — wipes all pass/fail colours and returns the tree to a neutral state
- **Re-run Failed** — reruns only the classes that failed in the last run
- **Multi-filter input** — type `@` to select project-scoped JUnit tags, combine filters with comma / `AND` / `&&`, or use `OR` / `||` for alternatives
- **Flexible sorting** — sort by source location, status, duration, or name with independent ascending and descending directions
- **Annotation filters** — string-valued test annotations are searchable alongside JUnit tags, result states, and text terms
- **Copy...** — the first context-menu action copies Maven commands, package names, class names (FQCN), full paths, or method names; full paths are also available for projects and packages, and multi-selection is supported
- **Inline reveal** — editor test actions reveal and focus the matching item in the dedicated Maven Test Explorer view
- **Codicon icons** — test tree uses native VS Code icons: `$(symbol-method)` for methods, `$(symbol-class)` for classes, and `$(symbol-namespace)` for packages; project rows stay compact without a redundant kind icon
- **`@BeforeAll` / lifecycle errors** — when a `@BeforeAll` method throws before any test runs, a dedicated `@BeforeAll` node appears in the sidebar with the full error message and stack trace pinned to the annotation line in the source file
- **JUnit `@Tag` filtering** — class and method tags are available from the custom filter input with project-scoped names such as `@javatest.smoke`; suggestions include contextual match counts, and method-level filters include inherited class tags
- **Inherited-test navigation** — inherited interface methods show their origin and provide separate context-menu actions to open the test declaration or concrete implementation class

---

## Requirements

- VS Code `^1.84.0`
- Java project with `pom.xml`
- Maven available on `PATH` (or configured via `mavenTestExplorer.mavenExecutable`)
- JUnit 5 + Maven Surefire Plugin

---

## Getting Started

1. Open a workspace containing a `pom.xml`
2. The extension activates automatically and builds the test tree
3. Run `mvn clean test` from any terminal — the sidebar updates on its own

---

## Toolbar Buttons

| Button | Action |
|--------|--------|
| ▶ | Run All — runs every discovered test through Maven |
| ↺ | Refresh — rescans Java sources and rebuilds the tree |
| 🕐 | Run History — pick a past run to restore its results |
| ⇔ | Expand / Collapse All — opens or closes the visible hierarchy |
| 🗑 | Clear — clear results, or clear results and history |
| ≡ | Sort — order tests by location, status, duration, or name |
| ☷ | View Mode — switch between tree and flat list views |

---

## Commands

All commands are available via **Command Palette** (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `Maven: Refresh Tests` | Rescan sources and rebuild the tree |
| `Maven: Run All Tests` | Run `mvn clean test` for all modules |
| `Maven: Re-run Failed Tests` | Rerun only failed classes from the last run |
| `Maven: Clean Test Reports` | Delete `target/surefire-reports` and `target/failsafe-reports` |
| `Maven: Clear Test Results` | Reset all result icons to neutral |
| `Maven: Show Run History` | Browse and restore past runs |

---

## Configuration

```jsonc
{
  // Path to Maven executable
  "mavenTestExplorer.mavenExecutable": "mvn",

  // Maven goals to execute
  "mavenTestExplorer.defaultCommand": "clean test",

  // Maven profiles to activate
  "mavenTestExplorer.defaultProfiles": [],

  // Extra arguments appended to every Maven command
  "mavenTestExplorer.additionalArgs": "",

  // Glob patterns for report files
  "mavenTestExplorer.reportGlobs": [
    "**/target/surefire-reports/TEST-*.xml",
    "**/target/failsafe-reports/TEST-*.xml"
  ],

  // Watch report files and auto-refresh
  "mavenTestExplorer.watchReports": true,

  // Delete old reports before each run to avoid stale results
  "mavenTestExplorer.clearReportsBeforeRun": true,

  // Show the output channel when a run starts
  "mavenTestExplorer.showOutputChannel": true
}
```

Use the links in the extension's dedicated `Row Layout` settings group or run `Maven Test Explorer: Configure Tree Visible Parts...` and `Maven Test Explorer: Configure List Visible Parts...` to select row parts in compact multi-select menus. The choices are shared across workspaces and persist between VS Code sessions.

The expander is always visible because collapsing and expanding nodes is part of the explorer's navigation behavior; all other row parts are optional.
Metadata can be expanded inside the picker and configured separately for original Java names hidden by `@DisplayName`, tags, inherited sources, flat-list class context, and virtual-test hints.

When horizontal space is limited, row metadata is truncated first, followed by duration and then the test name. Expanders, status and kind icons, and aggregate statistics are preserved longest.

---

## How It Works

```
mvn clean test
      │
      ▼
target/surefire-reports/TEST-*.xml
      │
      ▼  (FileSystemWatcher, 500ms debounce)
 surefireParser
      │
      ▼
 resultPublisher  ──►  Custom Maven Test Explorer
      │
      ▼
 Test Explorer sidebar updated
```

For AI-agent workflows (Claude Code, etc.) the flow is identical — the agent runs Maven, the extension picks up the results.

---

## Project Structure

```
src/
├── constants.ts           # All string literals and config keys
├── settings.ts            # Typed settings wrapper
├── mavenProjectDetector.ts # Finds pom.xml, extracts artifactId
├── javaTestScanner.ts     # Scans Java sources, detects @Test / @Nested
├── inlineTestBridge.ts    # Minimal Testing API bridge for editor gutter and results
├── surefireParser.ts      # Parses TEST-*.xml via fast-xml-parser
├── resultPublisher.ts     # Maps Surefire results onto discovered tests
├── mavenRunner.ts         # Spawns Maven process
├── runHistory.ts          # Workspace-scoped run history
└── extension.ts           # Entry point, command registration
```

---

## License

[MIT](LICENSE) © [covenant-17](https://github.com/covenant-17)
