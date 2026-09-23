# Docker deployment

ColumnPilot ships as a production Next.js standalone image and a Compose stack containing both the web console and ClickHouse. The defaults bind both services to loopback, which is appropriate for a single-machine deployment.

In hosted mode, ColumnPilot resolves the ClickHouse hostname before connecting, rejects private or reserved addresses, and pins the request to the validated DNS results. The Compose stack explicitly enables private targets because the application must reach the internal `clickhouse` service.

The Compose file fixes the default project name to `columnpilot`. Different checkout directories therefore share this project unless you supply a different name with `-p`. Use both unique project names and host ports when testing multiple versions; see the example below.

## Start the complete stack

1. Copy the environment template and replace the example password.

   ```powershell
   Copy-Item .env.example .env
   ```

2. Build and start both services.

   ```powershell
   docker compose up -d --build
   docker compose ps
   ```

3. Open `http://localhost:3000` and connect with these values:

   | Field | Value |
   | --- | --- |
   | Endpoint | `http://clickhouse:8123` |
   | User | Value of `CLICKHOUSE_USER` |
   | Password | Value of `CLICKHOUSE_PASSWORD` |
   | Database | Value of `CLICKHOUSE_DB` |

`clickhouse` is the Compose service name. The browser sends the connection values to the ColumnPilot server, which can resolve that name on the private Compose network.

On an empty data volume, `infra/clickhouse/initdb/00-initialize.sh` runs the SQL in `initdb/sql/` with an explicit `--database` argument. It uses `CLICKHOUSE_DB` (default `columnpilot`), including custom database names. The three example tables start with 5 sensor readings, 2 device events, and 1 maintenance entry. Restarting an initialized volume does not seed the data again.

## Upgrade an existing deployment

Keep the existing `.env` and database volumes. Compare `.env` with `.env.example` before upgrading, and update `COLUMNPILOT_IMAGE` to `columnpilot:0.4.1` when building this version locally. An explicit value in `.env` overrides the Compose default, so an old `columnpilot:0.4.0` value would label the new build incorrectly. Confirm the resolved image with `docker compose config --images`.

Older versions could create the example tables in `default` while leaving `columnpilot` empty. This fix applies to fresh volumes and does not move or overwrite existing tables. To keep using those tables, select `default` in the connection dialog. If moving them to another database is required, back up the data and plan an explicit migration after checking for destination-name conflicts. Changing `CLICKHOUSE_DB` alone does not migrate existing data. Do not delete volumes or force initialization to repair an existing deployment.

## Test another version alongside an existing deployment

Use a separate terminal for these session-local overrides. Select unused ports, build an independently tagged image, and use the same project name on every command:

```powershell
$env:COLUMNPILOT_IMAGE = "columnpilot:0.4.1"
$env:COLUMNPILOT_PORT = "3014"
$env:CLICKHOUSE_HTTP_PORT = "18124"
$env:CLICKHOUSE_NATIVE_PORT = "19104"
docker compose -p columnpilot-v041 up -d --build
docker compose -p columnpilot-v041 ps
docker compose -p columnpilot-v041 logs -f columnpilot clickhouse
docker compose -p columnpilot-v041 down
```

The console is available at `http://localhost:3014`. Its server still connects to `http://clickhouse:8123` inside this project's network. The `columnpilot-v041` project has its own named volumes; the final command stops that project and keeps its data. Close the terminal to discard the environment overrides.

## Operations

```powershell
docker compose ps
docker compose logs -f columnpilot clickhouse
docker compose pull clickhouse
docker compose up -d --build
docker compose down
```

`docker compose down` keeps the named ClickHouse data and log volumes. Adding `--volumes` permanently deletes the database data, so it should only be used for an intentional reset.

The web container runs as an unprivileged user, drops Linux capabilities, uses a read-only root filesystem, and exposes `/api/health` for health checks. Writable temporary files and the Next.js runtime cache use memory-backed filesystems.

## Network exposure

The default `COLUMNPILOT_BIND_ADDRESS=127.0.0.1` exposes the console only on the Docker host. To serve another machine, put a TLS reverse proxy in front of ColumnPilot. If changing the bind address, also configure authentication at the proxy and firewall access to the application.

ClickHouse ports remain bound to `127.0.0.1`. Do not expose port 8123 or 9000 directly to an untrusted network.

Compose sets `COLUMNPILOT_ALLOW_PRIVATE_TARGETS=true` for the web container because it must reach the private `clickhouse` service. This stack is intended for a trusted, single-operator deployment and must not be used as a public multi-tenant proxy.

## Use a prebuilt image

Set `COLUMNPILOT_IMAGE` to an image published by your own registry. Compose retains the local `build` definition, so use `--no-build` to start exactly that image:

```powershell
$env:COLUMNPILOT_IMAGE = "ghcr.io/your-account/columnpilot:0.4.1"
docker compose pull columnpilot
docker compose up -d --no-build
```

Never bake `.env` or credentials into an image. `.dockerignore` excludes local environment files, dependencies, build output, and repository metadata from the build context.
