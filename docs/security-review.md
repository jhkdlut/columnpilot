# Endpoint and request-limit review

ColumnPilot deliberately accepts a ClickHouse endpoint from the operator. This functionality requires reviewing both the default hosted policy and the explicit trusted-self-hosted exception; a user-controlled URL alone does not establish that the runtime checks can be bypassed.

## Hosted policy

With `NODE_ENV=production` and without `COLUMNPILOT_ALLOW_PRIVATE_TARGETS=true`:

- Require HTTPS, reject credentials embedded in the URL, and reject private/reserved literal addresses.
- Resolve the hostname once per outbound request; reject the entire answer if any address is private/reserved, including mixed IPv4/IPv6 answers.
- Supply the validated addresses to a per-request Undici dispatcher. Subsequent IPv4/IPv6 socket lookups use that fixed set rather than re-resolving the hostname.
- Reject HTTP redirects for both queries and imports; never forward the request or credentials to a redirect destination.
- Keep DNS resolution, sending and response reading within one deadline. Late DNS completion cannot start a request; destroy the dispatcher when finished.

`lib/clickhouse/server.test.ts` and `server-network.test.ts` cover direct private addresses, mixed DNS responses, production loopback Host headers, DNS rebinding through subsequent socket lookups, IPv6 literal normalization, redirects to IPv4/IPv6 loopback, late DNS completion, and dispatcher cleanup. Redirect tests use the real Fetch implementation with a network-disabled MockAgent. These are regression tests, not a claim of exhaustive penetration testing.

## Trusted self-hosted policy

Compose intentionally sets `COLUMNPILOT_ALLOW_PRIVATE_TARGETS=true` to reach its internal ClickHouse service. This opts out of public-address enforcement for a trusted operator. Access must remain on loopback or behind an authenticated TLS proxy and firewall. It is not safe to expose that configuration as an anonymous public endpoint; ColumnPilot itself does not provide application authentication. Database permissions still apply. An arbitrary internal target in this mode is an operator capability, not a supported multi-tenant boundary.

## Inbound limits and SQL checking

The API reads at most 256 KiB of JSON, or 8 MiB + 64 KiB of multipart data, before parsing. It checks both declared and actual byte counts, keeps buffer growth bounded, stops on client abort and times out body reads after 30 seconds. The file itself remains limited to 8 MiB. Oversize input returns HTTP 413; interrupted or timed-out reads return HTTP 408.

SQL is capped at 64 KiB of UTF-8 and scanned once by the existing tokenizer, which handles comments without the previous regex preprocessing. The ClickHouse request also forces `readonly=1`; the SQL checker does not replace database permissions. API regression tests ensure rejected payloads never reach the mocked ClickHouse client. Deployment proxies should apply their own body and timeout limits as well.

## Static-analysis findings

The previous SQL-comment regex reported by `js/polynomial-redos` has been removed. The `js/request-forgery` finding requires evaluating the runtime controls and deployment policy above; do not hide it with a broad query exclusion or disable the security ruleset. Record any alert disposition with the reviewed commit and regression evidence. A successful analysis job alone does not mean there are zero open findings.
