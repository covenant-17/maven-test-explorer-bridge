# Changelog

## [1.0.8] - 2026-08-25

### Fixed

- Prevented duplicate Run All execution by running each top-level Maven reactor once while collecting child-module reports.
- Made scoped runs and copied Maven commands non-recursive, and made Re-run Failed module-aware when artifact IDs or FQCNs collide.
- Recorded nonzero Maven exits as failed runs, including failures that produce no XML reports.
- Kept nested-module Java sources out of parent-module discovery and preserved failed run state across delayed report-watcher events.
- Made **Copy Full Path** on method rows include the fully qualified method selector and a standard `file:line` source anchor.

### Internal

- Added automated coverage for Maven reactor planning, module identity, result ownership, scoped arguments, and run outcomes.

---

## [1.0.7] - 2026-08-21

### Added

- Added direct `Class#method` and fully-qualified `Class#method` search in the custom explorer filter.

### Documentation

- Refreshed the README with current commands, settings, filter syntax, architecture, troubleshooting, and development validation.

---

## [1.0.6] - 2026-08-18

### Added

- Added Stop Current Run controls to the explorer toolbar and run statistics row.
- Preserved partial results and recorded cancelled runs in Run History.

---

## [1.0.5] - 2026-08-17

### Improved

- Simplified project rows in Tree and List views by removing the redundant project kind icon while preserving status, navigation, and actions.

---

## [1.0.4] - 2026-08-17

### Fixed

- Preserved duration and result statistics in narrow test rows by truncating long test names first.

### Internal

- Added a webview layout invariant to prevent row statistics from becoming shrinkable again.

---

## [1.0.3] - 2026-08-17

### Improved

- Added compact Tree/List row-part visibility selectors with expandable metadata options, plus predictable narrow-sidebar truncation priorities for metadata, duration, names, and statistics.
- Synchronized custom test/report globs with live watchers and report cleanup, applied watcher changes without reload, trimmed history immediately when its limit changes, and clarified every setting description around the problem it solves.

### Removed

- Removed obsolete native-tree statistics settings, inactive multi-module and method-template settings, legacy copy/AI command aliases, and old Test Explorer DOM snapshots.

### Internal

- Reduced the native Testing API integration to a minimal inline bridge for editor gutter actions, loaders, result messages, and error peek.
- Removed dead watcher/filter code and tightened TypeScript unused-code checks and VSIX packaging.

---

## [1.0.2] - 2026-08-13

### Improved

- **Explorer navigation** - inline test actions now reveal and focus the matching item in the dedicated Maven Test Explorer view.
- **Context actions** - `Copy...` is now the first context-menu entry, and full paths can be copied for projects and packages as well as source-backed test nodes.
- **Aggregate statistics** - header and expandable-node counters now share compact, consistently aligned SVG icons for passed, failed, errored, skipped, and total results.

---

## [1.0.1] - 2026-08-13

### Added

- **JUnit test interfaces** - inherited default test methods now appear under their concrete implementation class, with source context and separate navigation actions for the declaration and implementation class.
- **Dynamic invocation results** - repeated Surefire cases with the same method name are represented as individual generated invocations instead of overwriting one another.

### Improved

- **Large test suites** - virtualized tree and list rendering keeps expansion, scrolling, selection, and source navigation responsive in projects with thousands of tests.
- **Runtime feedback** - package and project loaders now disappear as soon as their final running descendant reports a result.

### Fixed

- Fixed aggregate counts for synthetic lifecycle results and unresolved tests during active Maven runs.
- Fixed result-to-module matching in multi-module workspaces by preferring the report file location.

---

## [1.0.0] - 2026-08-13

### Changed

- **Custom Maven Test Explorer** - completed the move to a dedicated test tree with deterministic discovery, flexible sorting, multi-selection, grouped Maven execution, source navigation, and contextual actions.
- **Advanced filtering** - added project-scoped JUnit tag and annotation suggestions, contextual match counts, quoted values, status filters, and AND/OR expressions.
- **Parameterized results** - added generated invocation nodes and parent indicators for parameterized Surefire test cases.

### Fixed

- Fixed a webview script escaping error that could leave the Maven Test Explorer tree completely blank.
- Added release-time validation of the generated webview JavaScript to prevent blank-screen syntax regressions.

---

## [0.2.13] - 2026-08-13

### Added

- **Dedicated Maven test tree** - added a custom Testing sidebar view with run actions, expand/collapse controls, and sorting by location, status, or duration.
- **Richer filtering** - added project-scoped tag suggestions with match counts, comma-separated filters, status aliases, quoted values, and string-valued annotation filters.

### Improved

- **Stable runtime updates** - test discovery and tree ordering are deterministic, while running indicators and report-driven results update without disrupting the current tree state.
- **Test navigation and actions** - improved multi-selection, context actions, source navigation, virtual invocation handling, and Maven target generation across the custom tree.

## [0.2.12] - 2026-07-08

### Added

- **Clickable JUnit tags** - `@Tag("...")` values in Java source now act as editor links that apply the matching Maven Test Explorer filter.

---

## [0.2.11] — 2026-07-01

### Improved

- **Advanced filter UX** — moved the AND / OR filter entry point into the Testing sidebar, removed the extra clear button, switched result tags to `@mavenTestExplorer:status.*`, and removed internal class/method tags from filter suggestions.

---

## [0.2.10] — 2026-07-01

### Added

- **Filter expressions** — added `Maven: Apply Test Filter Expression` with `AND` / `&&`, `OR` / `||`, parentheses, text terms, JUnit tags and result tags such as `@failed`; for example `@mavenTestExplorer:needCodeReviewD24 OR @failed`.

---

## [0.2.9] — 2026-06-05

### Added

- **JUnit `@Tag` filtering** — `@Tag("smoke")`, `@Tag("coverage")` and any other JUnit 5 tag annotations on classes and methods are now read during source scan and registered as native VS Code test tags. Use the filter box in Test Explorer (type `@tagname`) to show only matching tests. Tags on a class are automatically inherited by all its methods.

---

## [0.2.8] — 2026-05-27

### Fixed

- **Copy context menu works for `@BeforeAll`** — "Copy Maven Command" now generates a valid class-level `-Dtest=ClassName` instead of the invalid `ClassName#@BeforeAll`; all other copy actions (class name, package, full path, method name) work as expected.

---

## [0.2.7] — 2026-05-27

### Fixed

- **`@BeforeAll` error pinned to annotation line** — the `@BeforeAll` sidebar node now resolves the exact source line of the annotation in the Java file (skipping javadoc/comment occurrences) and sets `item.range` accordingly, so the inline error peek appears directly on `@BeforeAll` rather than at the top of the file.
- **Error output in test results panel** — for any `error`/`failed` test the exception type, message, and full stack trace are now streamed to the Output tab of the Test Results panel in addition to being shown in the peek view.

---

## [0.2.6] — 2026-05-26

### Fixed

- **@BeforeAll failure now visible in sidebar** — when JUnit 5 `@BeforeAll` (or a static initializer) throws before any test runs, Surefire records the error on the `<testsuite>` element with no `<testcase>` children. The extension now detects this and synthesises a `@BeforeAll` child node under the failing class, showing the full error message and stack trace. Previously the class showed a red marker but no clickable test entry.

---

## [0.2.2] — 2026-05-11

### Added

- **Running progress summary** — after each test class completes, the output channel now prints a live counter line:
  `[Progress] ✓ 12 passed  ✗ 1 failed  ⊘ 0 skipped  ⏳ 8 remaining`
  Counts accumulate across all classes in the run; `remaining` is computed from the total number of enqueued test items.

---

## [0.2.1] — 2026-05-07

### Changed

- Split AI chat attachment into two separate context menu actions: **Attach to Copilot Chat** (uses `github.copilot.chat.attachSelection`) and **Attach to Claude** (uses `claude-vscode.insertAtMention` + copies `file.java#startLine-endLine` path to clipboard as fallback).
- Extracted shared `openItemInEditor` helper — resolves class symbol range via `DocumentSymbolProvider` for class items that don't have a range set.

---

## [0.2.0] — 2026-05-07

### Added

- **Attach Class/Method to AI Chat** — right-click a class or method in the Test Explorer to attach its source code to the active AI chat (GitHub Copilot, Anthropic Claude Code, OpenAI ChatGPT/Codex). The source file opens in a preview tab, the relevant range is selected, all installed AI assistants receive the selection, then the tab closes automatically.
- Context menu entries are filtered: "Attach Class to AI Chat" appears only on class items, "Attach Method to AI Chat" only on method items — packages and modules are excluded.
- Multi-select supported: selecting multiple tests attaches each one sequentially.

---

## [0.1.9] — 2026-05-06

### Changed

- Updated README: corrected version badge, expanded Features section with codicons and Copy QuickPick details.

---

## [0.1.8] — 2026-05-06

### Changed

- Test tree now uses native VS Code codicons instead of Unicode placeholder symbols: `$(symbol-method)` for methods, `$(symbol-class)` for classes, `$(symbol-namespace)` for packages.

---

## [0.1.7] — 2026-05-06

### Added

- **Copy... (multi-select aware)** — right-click any test item to open a "Copy..." menu with 5 options: Maven Command, Package Name, Class Name (FQCN), Full Path, Method Name.
- Multi-selection works: Ctrl+Click several tests, then Copy... — all selected items are processed and joined with newlines.
- "Copy Maven Command" on multi-select groups methods by class and builds a single `-Dtest=Class1#m1+m2+Class2#m3` argument across all selected items.

> **Technical note:** VS Code only passes multi-select arguments to commands registered directly in `testing/item/context`. Submenu commands receive only one item — a VS Code architectural limitation confirmed in the source code. The solution uses a single direct command that opens a QuickPick instead of a submenu.

---

## [0.1.6] — 2026-05-06

### Fixed

- Selecting multiple methods (Shift+Click) across one or several classes now correctly runs all of them. Previously only the first method ran; now they are grouped per class and passed as `-Dtest=ClassName#method1+method2+...`.

---

## [0.1.5] — 2026-05-06

### Fixed

- Clicking a package node (e.g. `com.example.edge`) now runs only the tests in that package instead of the entire module.

---

## [0.1.4] — 2026-05-06

### Fixed

- Aggregate counts no longer grow when running the same test multiple times in a "sandwich" pattern (single → all → single). Cross-suite deduplication now correctly handles Surefire's behavior of reporting parent-class methods inside nested-class XML files, while preserving all invocations of `@TestFactory` and `@ParameterizedTest` methods within a single suite.

---

## [0.1.3] — 2026-05-06

### Fixed

- Aggregate stats now correctly restore after VS Code reload. Results are persisted to `workspaceState` after every run and restored on startup, so reloading the window no longer loses stats from previous runs.
- Running a single test no longer clears stats for other test classes in the tree.

---

## [0.1.2] — 2026-05-06

### Fixed

- Aggregate stats (✓/✗/⊘) now appear on startup when existing Surefire XML reports are already present on disk.
- Running a single test class or method no longer resets aggregate stats for the rest of the tree. Results from previous runs are preserved via an in-memory cache and merged with the new results before recomputing aggregates.

---

## [0.1.1] — 2026-05-06

### Fixed

- `clearReportsBeforeRun` no longer throws `EBUSY` when a JVM process holds a lock on `.bin` files in `surefire-reports`. Only `TEST-*.xml` files are now deleted instead of removing the entire directory.

---

## [0.1.0] — 2026-05-06

### Added

- Auto-discovery of Maven modules and JUnit 5 test classes via `pom.xml` detection
- Live sync — watches `target/surefire-reports/TEST-*.xml` and `target/failsafe-reports/TEST-*.xml` with 500 ms debounce
- Full JUnit 5 support: `@Test`, `@ParameterizedTest`, `@RepeatedTest`, `@Nested` (arbitrary depth)
- Run all tests, a single class, or a single method directly from the Test Explorer UI
- Multi-module Maven project support (`auto` / `root` / `perModule` modes)
- Maven Wrapper (`mvnw`) auto-detection
- Configurable test-class and test-method command templates
- Aggregate pass/fail/skip/total stats on every tree node
- Run History — stores up to 20 runs per workspace; restore any past result set with one click
- Clear Results — resets all result icons to neutral state
- Re-run Failed — reruns only classes that failed in the last run
- Copy Maven Command — copies the exact `mvn -Dtest=…` invocation to clipboard
- Auto-refresh on save with configurable debounce delay
- Output channel with Maven process output
