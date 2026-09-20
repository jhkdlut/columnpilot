# Development

## Prerequisites

- Docker Desktop or another Docker Engine with Compose v2
- Node.js 22.13 or newer
- npm

## Local workflow

1. Copy `.env.example` to `.env` and change the password if needed.
2. Run `npm run clickhouse:up`.
3. Install dependencies with `npm ci`.
4. Start ColumnPilot with `npm run dev`.
5. Open `http://localhost:5173` and use these connection values:
   - endpoint: `http://localhost:8123`
   - user: `columnpilot`
   - password: the value of `CLICKHOUSE_PASSWORD`
   - database: `columnpilot`

The native protocol is exposed on host port `19000` by default so it can coexist with other local ClickHouse stacks. ColumnPilot itself uses the HTTP port `8123`.
Both ports are bound to `127.0.0.1` by default and are not exposed to the local network.

The initialization scripts run only when the Docker volume is created for the first time. `docker compose down` keeps data; `docker compose down --volumes` permanently removes the local ClickHouse data and should be used deliberately.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run build
docker compose config
```

## Production notes

The Compose file is designed for local development. Before exposing ClickHouse to a network, replace the development password, restrict published ports, configure TLS, and create least-privilege users.

## Publish to GitHub later

After creating an empty GitHub repository, run:

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/columnpilot.git
git push -u origin main
```

Replace `YOUR_ACCOUNT` with the GitHub user or organization that owns the repository. Do not commit `.env` or any production credentials.
