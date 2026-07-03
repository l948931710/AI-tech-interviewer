# Database-side hardening notes

Some findings from the code review can only be fully closed with changes to the
Supabase/Postgres schema (RLS policies, constraints, and RPC functions). Those
objects live in the Supabase project, not in this repository (`*.sql` is
gitignored and there is no migrations directory), so they cannot be applied or
verified from the codebase. This document records the exact SQL an operator
should review and apply, and how it pairs with the application code.

> Apply these in the Supabase SQL editor (or your migration tooling) against the
> project referenced by `VITE_SUPABASE_URL`. Review each against your live schema
> before running — column names below assume the tables referenced in `api/`.

---

## H4 — Idempotent turn processing needs a unique constraint

`api/agent/next-step.ts` deduplicates retried turns by `requestId`, but the
transcript insert is deferred to `ctx.waitUntil(...)` and runs *after* the
response is returned. A retry that arrives before the background insert commits
misses the dedup check and re-runs the whole turn — a second Gemini call (double
billing) and a duplicate transcript row that corrupts state reconstruction.

The durable fix is a database-enforced uniqueness guarantee so a duplicate row
can never be committed regardless of timing:

```sql
-- One transcript row per (session, request). Requires request_id to be populated
-- on every insert (next-step.ts already sends requestId for normal turns; make
-- sure the hard-timeout closing turn also sets it — see finding L4).
ALTER TABLE session_transcripts
  ADD CONSTRAINT uq_session_transcripts_session_request
  UNIQUE (session_id, request_id);
```

Notes:
- If historical rows have `NULL` `request_id`, either backfill them or use a
  partial unique index instead so existing nulls don't block creation:
  ```sql
  CREATE UNIQUE INDEX uq_session_transcripts_session_request
    ON session_transcripts (session_id, request_id)
    WHERE request_id IS NOT NULL;
  ```
- With the constraint in place, the application can treat a `23505`
  unique-violation on insert as an idempotent hit (no-op) rather than an error.

---

## H1 — Single-use invite token enforcement lives in the `claim_invite_token` RPC

`api/agent/start.ts` calls `supabaseAdmin.rpc('claim_invite_token', { p_token_hash, p_session_id })`
to increment token usage. That function is **not** in this repo, so its behavior
could not be reviewed. The application-side change (idempotent start) now
guarantees the RPC runs at most once per session, but true single-use / usage-cap
enforcement depends entirely on this function.

The RPC should perform an **atomic** check-and-increment and return an empty
result when the token is exhausted, so the caller can enforce it. Recommended shape:

```sql
CREATE OR REPLACE FUNCTION claim_invite_token(p_token_hash text, p_session_id uuid)
RETURNS TABLE (id uuid, use_count int) AS $$
  UPDATE invite_tokens
     SET use_count = use_count + 1,
         is_used   = true
   WHERE token_hash = p_token_hash
     AND session_id = p_session_id
     AND revoked = false
     AND expires_at > now()
     AND use_count < max_uses            -- refuses to increment past the cap
  RETURNING id, use_count;
$$ LANGUAGE sql;
```

Then, in `api/agent/start.ts`, an empty RPC result should be treated as a hard
failure (reject the start) rather than only logged as a warning — do this once the
RPC contract above is confirmed, so a legitimate response shape is not mistaken
for exhaustion.

---

## C3 — Row Level Security is the only thing protecting candidate PII

The browser uses the Supabase **anon** key (`src/lib/supabase.ts`) and reads/writes
`interview_sessions` / `session_claims` directly (`src/lib/db_supabase.ts`),
including `listSessions()` which selects every session's `candidate_info` and
`report` with no `created_by` filter. If RLS is missing or permissive, anyone with
the public anon key can enumerate all candidates' PII and reports.

Confirm every table has RLS enabled and owner-scoped policies, e.g.:

```sql
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_owner_select ON interview_sessions
  FOR SELECT USING (auth.uid() = created_by);
CREATE POLICY sessions_owner_cud ON interview_sessions
  FOR ALL USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
```

Apply equivalent owner-scoped policies to `session_claims`, `session_transcripts`,
`invite_tokens`, and `invite_access_logs`. Candidate-facing reads/writes already go
through the authenticated `/api/*` service-role endpoints, so the anon client only
needs HR-owner access. As defense-in-depth, also add an explicit
`.eq('created_by', user.id)` filter to `listSessions()`/`getSession()` in
`src/lib/db_supabase.ts`.
