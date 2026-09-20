# Contributing

Thanks for improving ColumnPilot.

1. Follow the local setup in `docs/development.md`.
2. Create a focused branch from the default branch.
3. Keep changes scoped and avoid committing credentials, `.env`, build output, or database volumes.
4. Run `npm run typecheck`, `npm run lint`, and `npm run build` before opening a pull request.
5. Describe user-visible behavior, validation performed, and any ClickHouse schema implications in the pull request template.

For changes to SQL safety or connection validation, include focused tests or a reproducible verification procedure. Security issues should follow `SECURITY.md` instead of a public issue.
