# ColumnPilot

面向 ClickHouse 的轻量数据管理控制台。它提供连接检查、库表浏览、数据预览、只读 SQL 工作台，以及 CSV/JSONEachRow 导入。

ColumnPilot is a lightweight ClickHouse data console for browsing, querying, and importing data.

## Features

- ClickHouse 连接测试与实例概览
- 数据表、字段和数据预览
- 服务端强制只读的 SQL 工作台
- CSV、CSVWithNames 和 JSONEachRow 导入
- 单次查询 30 秒超时、最多返回 500 行
- 凭据仅随请求使用，应用不做持久化
- Docker Compose 本地 ClickHouse 与示例数据

## Quick start

### 1. Start ClickHouse

```powershell
Copy-Item .env.example .env
docker compose up -d clickhouse
docker compose ps
```

The Compose stack uses the official `clickhouse:26.8.6.5` image and initializes three demo tables on the first run.

### 2. Start ColumnPilot

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173`, then connect with:

| Field | Value |
| --- | --- |
| Endpoint | `http://localhost:8123` |
| User | `columnpilot` |
| Password | `columnpilot_dev` by default, or your `.env` value |
| Database | `columnpilot` |

ColumnPilot currently targets local or self-hosted deployment. The application server must be able to reach the ClickHouse HTTP endpoint.

## Repository layout

```text
columnpilot/
├─ app/                         # pages and ClickHouse API routes
├─ components/                  # product UI and used UI primitives
├─ lib/clickhouse/              # server integration and shared types
├─ infra/clickhouse/initdb/     # schema and demo seed SQL
├─ docs/                        # architecture and development notes
├─ .github/                     # CI and contribution templates
├─ compose.yaml                 # local ClickHouse service
└─ .env.example                 # documented local configuration
```

See [architecture](docs/architecture.md) and [development](docs/development.md) for more detail.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local web app |
| `npm run typecheck` | Run TypeScript validation |
| `npm run lint` | Run ESLint |
| `npm run build` | Create a production build |
| `npm run clickhouse:up` | Start local ClickHouse |
| `npm run clickhouse:down` | Stop local ClickHouse without deleting its volume |
| `npm run clickhouse:logs` | Follow ClickHouse logs |

## Security

The SQL workbench is read-only, but ClickHouse permissions remain the final security boundary. Do not expose the development Compose configuration to an untrusted network. Use TLS, a strong password, restricted ports, and least-privilege ClickHouse users for non-local environments.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE)
