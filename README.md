# ColumnPilot

面向 ClickHouse 的轻量数据管理控制台。它提供连接检查、库表浏览、数据预览、只读 SQL 工作台，以及 CSV/JSONEachRow 导入。

ColumnPilot is a lightweight ClickHouse data console for browsing, querying, and importing data.

## Features

- ClickHouse 连接测试与实例概览
- 数据表、字段和数据预览
- 服务端强制只读的 SQL 工作台
- 当前会话内最近 20 条成功 SQL 查询历史
- 查询结果和数据预览分页（每页 25、50 或 100 行）
- CSV、CSVWithNames 和 JSONEachRow 导入预览与字段校验
- 查询结果导出为 CSV 或 JSON
- 单次查询 30 秒超时、最多返回 500 行
- 凭据仅随请求使用，应用不做持久化
- 非 root、只读文件系统的生产 Docker 镜像
- 完整 Docker Compose 部署、健康检查、本地 ClickHouse 与示例数据

## Quick start

### Option A: start the complete Docker stack

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

Open `http://localhost:3000`, then connect to `http://clickhouse:8123` with the credentials in `.env`.

The stack builds the production ColumnPilot image, uses the official `clickhouse:26.8.6.5` image, and initializes three demo tables on the first run. See [Docker deployment](docs/deployment.md) for operations and safe network exposure.

### Option B: local application development

Start only ClickHouse:

```powershell
Copy-Item .env.example .env
docker compose up -d clickhouse
```

Then start ColumnPilot from the host:

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`, then connect with:

| Field | Value |
| --- | --- |
| Endpoint | `http://localhost:8123` |
| User | `columnpilot` |
| Password | `columnpilot_dev` by default, or your `.env` value |
| Database | `columnpilot` |

ColumnPilot currently targets local or self-hosted deployment. The application server must be able to reach the ClickHouse HTTP endpoint.

`npm run dev` allows loopback ClickHouse endpoints for local development. If a production build intentionally connects to Docker or another private-network ClickHouse server, set `COLUMNPILOT_ALLOW_PRIVATE_TARGETS=true` in the application server environment. Never enable that switch on a public multi-tenant deployment.

## Repository layout

```text
columnpilot/
├─ app/                         # pages and ClickHouse API routes
├─ components/                  # product UI and used UI primitives
├─ lib/clickhouse/              # server integration and shared types
├─ infra/clickhouse/initdb/     # schema and demo seed SQL
├─ docs/                        # architecture and development notes
├─ .github/                     # CI and contribution templates
├─ Dockerfile                   # production standalone web image
├─ compose.yaml                 # web and ClickHouse deployment
└─ .env.example                 # documented deployment configuration
```

See [architecture](docs/architecture.md) and [development](docs/development.md) for more detail.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local web app |
| `npm run typecheck` | Run TypeScript validation |
| `npm run lint` | Run ESLint |
| `npm test` | Run the automated test suite |
| `npm run build` | Create a production build |
| `npm run clickhouse:up` | Start local ClickHouse |
| `npm run clickhouse:down` | Stop local ClickHouse without deleting its volume |
| `npm run clickhouse:logs` | Follow ClickHouse logs |
| `npm run docker:up` | Build and start the complete Docker stack |
| `npm run docker:down` | Stop the stack without deleting database volumes |
| `npm run docker:logs` | Follow web and ClickHouse logs |

## Security

The SQL workbench is read-only, but ClickHouse permissions remain the final security boundary. Production builds reject HTTP and private-network ClickHouse targets by default. Do not expose the development Compose configuration to an untrusted network. Use TLS, a strong password, restricted ports, and least-privilege ClickHouse users for non-local environments.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE)
