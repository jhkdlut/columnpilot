# Changelog

All notable changes to ColumnPilot are documented in this file.

## [0.4.1] - 2026-09-24

### Fixed

- Reject redirects for ClickHouse queries and imports so redirects cannot bypass endpoint restrictions or forward credentials to a new destination.
- Apply query and import-write deadlines to DNS resolution, connection setup, and response reading; late DNS results cannot start an expired request.
- Initialize demo tables in the configured `CLICKHOUSE_DB`, including custom database names, without changing existing volumes.
- Align the environment template and Compose image tag with version 0.4.1.

### Added

- Default 30-second cancellation for import-write requests.
- Public-address DNS validation and connection pinning for hosted deployments.
- Weekly Dependabot checks for npm, Docker, and GitHub Actions, and CodeQL security analysis.
- Docker Compose first-start acceptance checks for default/custom databases, API connectivity, CSV import, and restart persistence.

### Documentation

- Document existing-volume upgrades and isolation by Compose project name and host ports.
- Require automated tests and applicable deployment acceptance checks for contributions.

## [0.4.0] - 2026-09-21

### Added

- Multi-stage production Docker image for the Next.js standalone server.
- Complete Compose deployment for the ColumnPilot web service and ClickHouse.
- Application health endpoint and container health checks.
- Dedicated Docker deployment and operations guide.

### Security

- The web container runs as an unprivileged user with all Linux capabilities dropped.
- The Compose deployment uses a read-only root filesystem with memory-backed runtime cache directories.
- Web and ClickHouse ports remain bound to loopback by default.

### Changed

- Added Docker image builds to continuous integration.
- Updated package metadata to version 0.4.0.

## [0.3.0] - 2026-09-20

### Added

- Session-scoped history for the 20 most recent successful SQL queries, including execution time and row counts.
- One-click loading of historical SQL back into the editor without executing it automatically.
- Client-side pagination for query results and table previews, with 25, 50, and 100 row page sizes.
- Focused unit tests for query-history deduplication and pagination boundaries.

### Changed

- Result tables now render one page at a time while CSV and JSON exports continue to include the complete result set.
- Version development now uses dedicated release branches and feature pull requests before promotion to `main`.

### Privacy

- Query history stays in browser memory for the current page session and is not written to local storage.

## [0.2.0] - 2026-09-20

### Added

- Schema-aware previews and validation for CSV, CSVWithNames, and JSONEachRow imports.
- CSV and JSON downloads for the current SQL query result.
- Automated tests for SQL safety, import parsing, and result serialization.

### Changed

- Split the main dashboard into focused import, query, result, data, and type modules.
- Import jobs now represent real results from the current session instead of demo activity.
- Help, schema, navigation, and refresh controls now have explicit behavior and state.
- CI now runs the Vitest suite in addition to linting, type checks, and the production build.
- Updated dependencies to a zero-known-vulnerability npm audit baseline.

### Security

- Expanded private-network target detection and read-only SQL enforcement.
- Replaced Host-header-based private-network access with an explicit production opt-in.
- The server reloads table metadata and validates import files before inserting data.
- Imports use an explicit, safely quoted destination-column list.

## [0.1.0] - 2026-09-19

- Initial public release with ClickHouse connection checks, metadata browsing, data previews, a read-only SQL workbench, and Docker Compose setup.
