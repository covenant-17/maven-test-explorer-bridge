<p align="center">
  <img src="icon-17-128.png" width="96" alt="Maven Test Explorer Bridge" />
</p>

# Maven Test Explorer Bridge

> Bridge between **Maven/Surefire** and the **VS Code Testing sidebar** — no Microsoft Java Test Runner required.

[![Version](https://img.shields.io/badge/version-0.2.6-brightgreen)](CHANGELOG.md)
[![VS Code Engine](https://img.shields.io/badge/vscode-%5E1.84.0-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why?

When tests are run via **Maven** (from a terminal, a CI pipeline, or an AI agent like Claude Code), the VS Code Testing sidebar stays silent — it simply doesn't know what happened.

This extension fixes that. It watches `target/surefire-reports/TEST-*.xml`, parses the results, and pushes them into the native VS Code Testing UI automatically.

**Maven runs the tests. VS Code shows the results. That's it.**

---

## Features

- **Auto-discovery** — finds all Maven modules and JUnit 5 test classes in the workspace
- **Live sync** — detects Surefire/Failsafe XML changes and updates the sidebar without any manual action
- **Full JUnit 5 support** — `@Test`, `@ParameterizedTest`, `@RepeatedTest`, `@Nested` (including deeply nested classes)
- **Run from UI** — run all tests, a single class, or a single method via Maven directly from Test Explorer; multi-selection supported
- **Aggregate stats** — each tree node shows `| ✓N | ✗N | = N | T` counts at a glance
- **Run History** — last 20 runs stored per workspace; restore any previous result set with one click
- **Clear Results** — wipes all pass/fail colours and returns the tree to a neutral state
- **Re-run Failed** — reruns only the classes that failed in the last run
- **Copy...** — right-click any test item to copy: Maven command, package name, class name (FQCN), full file path, or method name; works with multi-selection
- **Codicon icons** — test tree uses native VS Code icons: `$(symbol-method)` for methods, `$(symbol-class)` for classes, `$(symbol-namespace)` for packages
- **`@BeforeAll` / lifecycle errors** — when a `@BeforeAll` method throws before any test runs, a dedicated `@BeforeAll` node appears in the sidebar with the full error message and stack trace pinned to the annotation line in the source file

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
| ↺ | Reload — rescans Java sources and rebuilds the tree |
| 🗑 | Clear Results — removes all pass/fail colours |
| 🕐 | Run History — pick a past run to restore its results |

---

## Commands

All commands are available via **Command Palette** (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `Maven: Refresh Tests` | Rescan sources and rebuild the tree |
| `Maven: Run All Tests` | Run `mvn clean test` for all modules |
| `Maven: Re-run Failed Tests` | Rerun only failed classes from the last run |
| `Maven: Clean Test Reports` | Delete `target/surefire-reports` and `target/failsafe-reports` |
| `Maven: Copy Maven Command for Test` | Copy the last Maven command to clipboard |
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
 resultPublisher  ──►  VS Code Testing API
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
├── testTreeBuilder.ts     # Builds VS Code TestItem hierarchy
├── surefireParser.ts      # Parses TEST-*.xml via fast-xml-parser
├── resultPublisher.ts     # Pushes results into VS Code Testing API
├── mavenRunner.ts         # Spawns Maven process
├── reportWatcher.ts       # FileSystemWatcher + debounce
├── runHistory.ts          # Workspace-scoped run history
└── extension.ts           # Entry point, command registration
```

---

## License

[MIT](LICENSE) © [covenant-17](https://github.com/covenant-17)
