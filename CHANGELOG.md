# Changelog

All notable changes to ColumnPilot are documented in this file.

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
