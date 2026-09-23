import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const image = process.env.COLUMNPILOT_SMOKE_IMAGE || "columnpilot:ci";
const shutdown = new AbortController();
const baseEnv = { ...process.env };
for (const key of Object.keys(baseEnv)) {
  if (key.startsWith("COMPOSE_")) delete baseEnv[key];
}
baseEnv.COMPOSE_DISABLE_ENV_FILE = "1";

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown.abort(new Error(`Smoke test interrupted (${signal})`)));
}

async function docker(args, { env = baseEnv, cleanup = false, timeout = 60_000 } = {}) {
  const result = await runFile("docker", args, {
    cwd: root,
    env,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    signal: cleanup ? undefined : shutdown.signal,
  });
  return result.stdout.trim();
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(45_000)]),
  });
  const body = await response.text();
  assert.ok(response.ok, `${url}: HTTP ${response.status}: ${body}`);
  return JSON.parse(body);
}

async function checkVersions() {
  const [packageText, composeText, exampleText] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "compose.yaml"), "utf8"),
    readFile(path.join(root, ".env.example"), "utf8"),
  ]);
  const { version } = JSON.parse(packageText);
  assert.ok(composeText.includes(`COLUMNPILOT_IMAGE:-columnpilot:${version}`), "Compose default image must match package version");
  assert.ok(exampleText.split(/\r?\n/).includes(`COLUMNPILOT_IMAGE=columnpilot:${version}`), ".env.example image must match package version");
}

async function assertUnusedProject(project) {
  // Check names as well as labels: an unlabelled volume with the same name
  // would otherwise be reused by Compose and then removed during cleanup.
  for (const args of [
    ["ps", "--all", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"],
    ["network", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"],
    ["volume", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Name}}"],
    ["ps", "--all", "--filter", `name=${project}`, "--format", "{{.Names}}"],
    ["network", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"],
    ["volume", "ls", "--filter", `name=${project}`, "--format", "{{.Name}}"],
  ]) {
    assert.equal(await docker(args), "", `Refusing to reuse existing resources for ${project}`);
  }
}

async function resolveBaseUrl(compose) {
  const bindings = await Promise.all([
    compose(["port", "columnpilot", "3000"]),
    compose(["port", "clickhouse", "8123"]),
    compose(["port", "clickhouse", "9000"]),
  ]);
  for (const binding of bindings) {
    assert.match(binding, /^127\.0\.0\.1:[1-9]\d*$/, `Unexpected non-loopback or unpublished binding: ${binding}`);
  }
  assert.equal(new Set(bindings).size, 3, "Services must use distinct dynamically allocated ports");
  return `http://${bindings[0]}`;
}

async function runCase(database) {
  const project = `columnpilot-smoke-${randomUUID().replaceAll("-", "")}`;
  const temp = await mkdtemp(path.join(tmpdir(), "columnpilot-smoke-"));
  const envFile = path.join(temp, "empty.env");
  const env = {
    ...baseEnv,
    COLUMNPILOT_IMAGE: image,
    COLUMNPILOT_BIND_ADDRESS: "127.0.0.1",
    COLUMNPILOT_PORT: "0",
    COLUMNPILOT_ALLOW_PRIVATE_TARGETS: "true",
    CLICKHOUSE_DB: database,
    CLICKHOUSE_USER: "columnpilot_smoke",
    CLICKHOUSE_PASSWORD: "smoke_test_only_not_a_secret",
    CLICKHOUSE_HTTP_PORT: "0",
    CLICKHOUSE_NATIVE_PORT: "0",
  };
  const composeArgs = ["compose", "--project-name", project, "--file", path.join(root, "compose.yaml"), "--env-file", envFile];
  const compose = (args, options = {}) => docker([...composeArgs, ...args], { env, ...options });
  let ownsProject = false;
  let failure;

  try {
    await writeFile(envFile, "# Deliberately ignore checkout-local environment files.\n");
    await assertUnusedProject(project);
    ownsProject = true;
    console.log(`[compose smoke] ${database}: starting isolated project ${project}`);
    await compose(["up", "--detach", "--no-build", "--wait", "--wait-timeout", "180"], { timeout: 360_000 });

    let baseUrl = await resolveBaseUrl(compose);
    const connection = {
      endpoint: "http://clickhouse:8123",
      user: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
      database,
    };
    const api = async (body) => {
      const result = await jsonRequest(`${baseUrl}/api/clickhouse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection, ...body }),
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.result;
    };
    const query = async (sql) => (await api({ action: "query", sql })).data;
    const checkData = async (expectedReadings) => {
      const tables = await query("SELECT database, name FROM system.tables WHERE name IN ('sensor_readings', 'device_events', 'maintenance_log') ORDER BY name");
      assert.deepEqual(tables, ["device_events", "maintenance_log", "sensor_readings"].map((name) => ({ database, name })), "Demo tables must exist only in the configured database");
      assert.deepEqual(await query("SELECT name FROM system.tables WHERE database = 'default'"), [], "The default database must remain empty");
      const [counts] = await query("SELECT (SELECT count() FROM sensor_readings) AS readings, (SELECT count() FROM device_events) AS events, (SELECT count() FROM maintenance_log) AS maintenance");
      assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])), { readings: expectedReadings, events: 2, maintenance: 1 });
    };

    assert.equal((await jsonRequest(`${baseUrl}/api/health`)).status, "ok");
    const [ping] = (await api({ action: "ping" })).data;
    assert.equal(ping.database, database);
    assert.equal(ping.user, env.CLICKHOUSE_USER);
    await checkData(5);

    const device = `smoke-${randomUUID()}`;
    const csv = `time,device_id,metric,value,unit\n2026-01-01 00:00:00.000,${device},smoke,123.5,test\n`;
    const form = new FormData();
    form.set("file", new File([csv], "compose-smoke.csv", { type: "text/csv" }));
    form.set("connection", JSON.stringify(connection));
    form.set("database", database);
    form.set("table", "sensor_readings");
    form.set("format", "CSVWithNames");
    const imported = await jsonRequest(`${baseUrl}/api/clickhouse/import`, { method: "POST", body: form });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    const checkImport = async () => {
      assert.deepEqual(await query(`SELECT device_id, metric, value, unit FROM sensor_readings WHERE device_id = '${device}'`), [
        { device_id: device, metric: "smoke", value: 123.5, unit: "test" },
      ]);
    };
    await checkImport();
    await checkData(6);

    await compose(["restart", "--timeout", "15"], { timeout: 90_000 });
    await compose(["up", "--detach", "--no-build", "--wait", "--wait-timeout", "180"], { timeout: 240_000 });
    // Docker may allocate new host ports when a container with port 0 restarts.
    baseUrl = await resolveBaseUrl(compose);
    assert.equal((await jsonRequest(`${baseUrl}/api/health`)).status, "ok");
    await checkData(6);
    await checkImport();
    console.log(`[compose smoke] ${database}: health, database, seed, CSV import, query, and restart checks passed`);
  } catch (error) {
    failure = error;
    if (ownsProject) {
      for (const args of [["ps", "--all"], ["logs", "--no-color", "--tail", "80"]]) {
        try {
          console.error(await compose(args, { cleanup: true }));
        } catch (diagnosticError) {
          console.error(`Could not collect Compose diagnostics: ${diagnosticError.message}`);
        }
      }
    }
  } finally {
    if (ownsProject) {
      try {
        // This random project was proven absent before up. Do not use global
        // prune, external volumes, or a user's ordinary Compose project here.
        await compose(["down", "--volumes", "--timeout", "15"], { cleanup: true, timeout: 90_000 });
        console.log(`[compose smoke] removed temporary containers, network, and volumes for ${project}`);
      } catch (cleanupError) {
        console.error(`Cleanup failed for ${project}; inspect this exact project before removing its resources.`);
        failure = failure ? new AggregateError([failure, cleanupError], "Smoke test and cleanup failed") : cleanupError;
      }
    }
    await rm(envFile, { force: true });
    await rmdir(temp);
  }
  if (failure) throw failure;
}

try {
  await checkVersions();
  await docker(["compose", "version"]);
  await docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  for (const database of ["columnpilot", "columnpilot_smoke_custom"]) await runCase(database);
  console.log("[compose smoke] all cases passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
