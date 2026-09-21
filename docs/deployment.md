# Docker deployment

ColumnPilot ships as a production Next.js standalone image and a Compose stack containing both the web console and ClickHouse. The defaults bind both services to loopback, which is appropriate for a single-machine deployment.

Compose-generated container and volume names are scoped by the project name, so multiple checked-out versions can be tested without sharing database storage.

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
$env:COLUMNPILOT_IMAGE = "ghcr.io/your-account/columnpilot:0.4.0"
docker compose pull columnpilot
docker compose up -d --no-build
```

Never bake `.env` or credentials into an image. `.dockerignore` excludes local environment files, dependencies, build output, and repository metadata from the build context.
