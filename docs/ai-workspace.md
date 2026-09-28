# Intelligent queries

The workspace supports one selected table per query: column selection, AND-combined filters, count/sum/avg/min/max, grouping, ordering and Top N. Queries are generated as structured plans, validated against fresh metadata, previewed, and executed only when requested. Raw model SQL is never executed. Writes, joins, external table sources, views, complex types and persistent conversations are outside this version.

## Enable simulation

Set `COLUMNPILOT_AI_MODE=mock` in your local `.env`, then rebuild/recreate the web service with Compose. Existing ClickHouse volumes do not need changes. Open **智能问数** after connecting to ClickHouse, select a database/table and try:

- `查看前 20 条记录`
- `统计记录总数`
- `value 最大的 5 条记录`
- `按 device_id 统计 value 的平均值`
- `最近 7 天按 device_id 统计 value 的平均值`
- `筛选 value >= 100`
- `改为最近 30 天` after generating a plan
- `只看 device_id = DV-0042` after generating a plan

Replace field names with actual columns. The mock provider uses these exact sentence patterns, not a language model. Unsupported questions return clarification. Its explanations are labeled fixture text. Queries and exports use real database results, which may be empty depending on the data and time range. Simulation never contacts an external model.

`disabled` is the default mode and preserves all existing features without model configuration. `http` enables the generic contract below. A provider-specific model connection has **not** been accepted yet; the HTTP adapter is tested with local protocol fixtures, not certified against any vendor API.

## Data handling and execution

Planning sends the question, selected table names/types/comments and at most ten previous question/plan pairs. History is capped at 24 KiB; table structure at 200 columns / 48 KiB. No sample rows or database credentials go to the provider. Relative date filters resolve once at preview time using UTC; `lastDays` means the preceding N 24-hour periods (date-only columns use UTC day boundaries). Review the resolved parameter values before executing.

The server signs the normalized plan, schema fingerprint, connection binding and ten-minute expiry. Execution rechecks the signature, connection, schema, table engine and SELECT access. It recompiles the signed plan rather than accepting browser-supplied SQL. The signature is tamper protection, not application authentication; access to ColumnPilot must remain limited to trusted operators.

The supported engines are MergeTree, ReplacingMergeTree, SummingMergeTree, AggregatingMergeTree, CollapsingMergeTree, VersionedCollapsingMergeTree, ReplicatedMergeTree, ReplicatedReplacingMergeTree, Memory, Log, TinyLog and StripeLog. Other engines fail closed. SELECT authorization is checked before metadata is sent to the provider. Database grants remain the final authority; restrict database users to intended objects and privileges.

Each query uses a 30-second deadline, an explicit maximum of 500 displayed rows and a 2 MiB response limit. One extra row is requested to detect truncation and is not shown/exported. The preview displays the actual parameterized SQL and bound values. The SQL-workbench inspection copy retains placeholders and must be edited before manual execution there.

Optional result explanation requires a separate consent checkbox. It sends the executed query, bound parameters, question, column metadata, returned-row count, truncation flags and at most 20 rows, with a total sample limit of 64 KiB. The server signs that sample so browser edits cannot substitute fabricated results. Sample truncation is distinct from query truncation. Explanations must not treat a partial sample as full-table evidence. Turn off result sharing for sensitive data or use a suitable privately hosted provider.

Receipts contain the plan or limited result sample, not database credentials. They stay in page memory; they are not encrypted and should be treated like the displayed data. Switching connection/database/table clears the session. Refreshing the page clears conversations. An empty `COLUMNPILOT_AI_SIGNING_KEY` uses a process-local random key, so restart invalidates receipts. Set a strong shared secret for deployments with multiple application workers; rotating it invalidates existing previews.

## Provider-neutral HTTP contract

Configure these server-only variables:

| Variable | Purpose |
| --- | --- |
| `COLUMNPILOT_AI_MODE` | `disabled`, `mock`, or `http` |
| `COLUMNPILOT_AI_ENDPOINT` | Full POST endpoint implementing this contract, without embedded credentials, query string or fragment |
| `COLUMNPILOT_AI_MODEL` | Model identifier forwarded to the adapter |
| `COLUMNPILOT_AI_API_KEY` | Optional Bearer credential, never sent to the browser or placed in prompts |
| `COLUMNPILOT_AI_ALLOW_HTTP` | Explicit opt-in for a trusted self-hosted HTTP endpoint; otherwise HTTPS required |
| `COLUMNPILOT_AI_SIGNING_KEY` | Optional shared random secret of at least 32 bytes for query/result receipts |

The endpoint is controlled by the deployment configuration, never a browser request. Redirects are rejected. A request has a 30-second timeout, a 128 KiB input cap and a 64 KiB response cap. At most two provider calls run concurrently per process; there are no automatic retries. One user turn generates one plan, followed by an optional explanation. The application has no multi-tenant authentication or global spending quota; keep it behind an authenticated proxy when shared.

This is a **ColumnPilot protocol**, not a direct vendor API format. An adapter translates it to the chosen model's API. The same configured endpoint handles both operations:

```json
{
  "protocol": "columnpilot.ai.v1",
  "operation": "plan",
  "model": "configured-model",
  "instructions": "server-generated execution constraints",
  "input": {
    "question": "按 device_id 统计 value 的平均值",
    "schema": {
      "database": "columnpilot",
      "table": "sensor_readings",
      "engine": "MergeTree",
      "columns": [
        { "name": "device_id", "type": "String", "comment": "" },
        { "name": "value", "type": "Float64", "comment": "" }
      ]
    },
    "history": [],
    "now": "2026-09-28T00:00:00.000Z",
    "timezone": "UTC"
  }
}
```

Return a plan (all listed plan fields required; unknown fields rejected):

```json
{
  "kind": "plan",
  "plan": {
    "table": "sensor_readings",
    "columns": ["device_id"],
    "filters": [],
    "aggregations": [{ "fn": "avg", "column": "value" }],
    "groupBy": ["device_id"],
    "orderBy": [{ "column": "metric_1", "direction": "desc" }],
    "limit": 100
  }
}
```

Or return `{ "kind": "clarification", "message": "Which metric should be used?" }`.

Filters use `{ "column": "value", "op": "gte", "value": "100" }`. Allowed operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `isNull`, `notNull`, `lastDays`. Null operators take no value. `lastDays` takes an integer from 1 to 3660 on a date column. Absolute dates use UTC ISO strings; exact large integers should be strings. Conditions combine with AND; at most 20 resolved conditions, 20 output columns, 5 grouping columns, 5 aggregates and 5 sort fields are supported. Aggregates are named `metric_1`, `metric_2`, etc. `count` may omit `column`; sum/avg require numeric columns. Aggregated output columns must equal the group-by columns.

For `operation: "explain"`, `input` has `question`, `sql`, `parameters`, `meta`, `rows`, `returnedRows`, `queryTruncated`, and `sampleTruncated`. Return `{ "text": "Explanation grounded in the supplied executed result." }`, at most 8,000 characters. Text is rendered as plain text, never executable HTML.

## Acceptance

Compiler, API, receipt and provider transport tests cover invalid plans, parameter boundaries, engine restrictions, schema changes, consent, sample limits, malformed responses and deadlines. Compose tests exercise mock planning against real ClickHouse, including aggregates, filters, follow-ups and result truncation.

Real model acceptance remains pending until a provider/model is selected. Record its protocol mapping, configuration, representative questions, result comparisons, errors and data-sharing behavior before claiming a validated integration. Never record API keys or sensitive data in the repository.
