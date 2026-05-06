# Changelog

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
