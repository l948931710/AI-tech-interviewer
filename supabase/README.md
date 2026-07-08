# Supabase migrations

Schema changes go through the Supabase **CLI** with human review — the agent
*proposes* a migration; a human runs `db push --dry-run`, reviews, and pushes.
**No agent ever runs `alter` / `delete` / `db push` against production directly.**

## Pending migrations

| File | What | Risk |
|---|---|---|
| `migrations/20260708000001_rate_limiting.sql` | `rate_limits` table + `incr_rate_limit` RPC (C4) | additive, none |
| `migrations/20260708000002_transcript_idempotency.sql` | dedupe + `UNIQUE(session_id, request_id)` (C1) | **contains a DELETE — review first** |

Both are idempotent (safe to re-run). The app fails **open/safe** until they're
applied (rate-limit RPC errors → allow; missing cost column → treated as 0).

## Apply (you run this, after review)

```bash
# one-time
supabase init            # generates config.toml; keeps existing migrations/
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>

# review, then push
supabase db push --dry-run     # lists which migrations will run
#   → open 20260708000002_transcript_idempotency.sql, read the DELETE
#   → optionally run its PREFLIGHT SELECT in the SQL Editor to see impact
supabase db push               # applies after you're satisfied
```

Since this project's base tables were created in the dashboard (not via CLI), the
remote migration history is empty, so `db push` applies exactly these two files.

> Prefer not to install the CLI? The same SQL can be pasted into the
> **Dashboard → SQL Editor** and run — start with the preflight `SELECT` in
> `20260708000002_...` before the rest.

## Baselining the older schema (later, optional)

The historical migrations still live in `scripts/*.sql` (invite tokens, llm usage
logs, RLS, etc.) — they were applied via the dashboard. To bring them under CLI
management, copy them into `migrations/` with earlier timestamps and mark them
already-applied with `supabase migration repair --status applied <version>` so
`db push` doesn't try to re-run them. Not required to apply the two pending ones.

## Read-only inspection via MCP (optional, recommended for the coding agent)

To let the coding agent read your schema / logs / generate types without you
pasting SQL, add the official Supabase MCP **scoped read-only**:

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=<YOUR_PROJECT_REF>&read_only=true&features=database,docs"
    }
  }
}
```

`read_only=true` + `project_ref` keeps it to reading one project (no accidental
writes). Keep schema *changes* on the CLI + review flow above.
