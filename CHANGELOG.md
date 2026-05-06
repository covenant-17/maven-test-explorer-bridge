# Changelog

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

## [1.0.0] — 2026-05-06

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
