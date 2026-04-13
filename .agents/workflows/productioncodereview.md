---
description: review code
---

# Production Code Review — AI Interviewer System

## Role & Accountability

You are a **staff-level engineer**. Your decision to block or approve this system has real consequences: failed interviews, legal exposure, and billing abuse if you approve prematurely.

You are responsible for blocking or approving real-world usage with **external candidates**.

Be **strict, concrete, and evidence-based**. Do NOT give generic praise.

---

## Scope

Review the full codebase unless otherwise specified. **Cite specific file paths and line numbers for every issue raised.** Do not make claims you cannot point to in code.

---

## Review Goals

Evaluate whether the system is **safe, reliable, and production-ready**.

Focus on:

- Correctness
- Resilience
- Maintainability
- Security
- Observability
- Real-world failure handling
- Legal and compliance exposure

---

## Review Dimensions

### 1. Interview State Integrity

- Can state become inconsistent across reconnects, concurrent events, or mid-turn interruptions?
- Are all transitions (`intro → claim → follow-up → end`) explicitly enumerated and validated — or implicit and assumed?
- Are counters (non-answers, failed claims, follow-ups) atomic and drift-resistant? What happens on retry or duplicate event delivery?
- Is there a **maximum interview duration** enforced server-side, independent of client behavior?

---

### 2. LLM Output Safety

- Is every model response validated against a **strict schema** before use? What library or mechanism enforces this?
- What happens on malformed, empty, truncated, or partially valid output? Is there retry with backoff? Is there a safe fallback response that doesn't break the interview flow?
- **Context window management:** How is the growing transcript handled across a 45-minute session? Is there a truncation, summarization, or sliding-window strategy? What happens at the token limit — crash, silent truncation, or graceful degradation?
- **Prompt brittleness:** Evaluate each prompt against these specific failure modes:
  - (a) Model ignores formatting instructions entirely
  - (b) Model produces structurally valid JSON with unexpected or missing keys
  - (c) Model refuses the request due to a content policy trigger
  - (d) Model produces plausible but factually hallucinated structure (e.g., invented follow-up questions)

  Is each of these cases explicitly handled in code?

---

### 3. Session & Authorization Safety

- Are **all `/api/*` endpoints** authenticated and authorized server-side on every request — not just at login?
- Is **session ownership** verified, not just session existence? Can user A access or manipulate user B's session with a valid token?
- Is there session expiration? What happens to an abandoned session after 30 minutes of inactivity?
- Can an authenticated user abuse endpoints through repeated calls, parameter manipulation, or replayed requests?

---

### 4. Failure Mode Coverage

Document the system's explicit behavior for each of the following — not assumed behavior:

| Failure Scenario | Expected Behavior | Actual Behavior (from code) |
|---|---|---|
| User gives no answer | | |
| User gives irrelevant answer | | |
| Silence timeout triggers mid-speech | | |
| Transient network failure (< 5s) | | |
| Third-party API outage (sustained, > 5 min) | | |
| LLM returns an error code | | |
| TTS fails mid-sentence | | |

- Are there **infinite loops or stuck terminal states**? Walk through the state machine for each failure path explicitly.
- **Vendor outage:** Is there a circuit breaker or fallback provider for LLM, TTS, and STT services? What is the candidate-facing UX when a provider is unavailable for 10 minutes?

---

### 5. Rate Limiting & Cost Control

- Is there **per-session and per-user rate limiting** on LLM, TTS, and STT endpoints?
- What is the **maximum possible cost** of a single session? Of a single user account? Has this been calculated and documented?
- Can a malicious user trigger runaway LLM calls through crafted input, rapid re-submission, or direct endpoint abuse?
- Are **billing anomaly alerts** configured with thresholds? Who gets paged?

---

### 6. Security & Prompt Injection

- Are API keys **server-side only**, never exposed to the client? Check: network responses, JS bundle, env var handling, and client-side config files.
- **Resume injection:** Can a candidate embed hidden instructions in a resume (white-on-white text, PDF metadata, invisible Unicode, zero-width characters) that get interpolated into a system prompt? Test this explicitly.
- Is candidate-provided content **strictly isolated using proper message roles** (`system` vs. `user`) — never concatenated directly into system prompt strings?
- Are system prompts and user content separated structurally, not just by convention?
- Is transcript and resume content **HTML-escaped** before rendering anywhere in the UI?
- Is any **client-provided data trusted without server-side validation**? List every instance.

---

### 7. Bias, Fairness & Legal Compliance

This dimension is non-negotiable for any AI system used in hiring.

- Does the LLM make or influence hiring decisions (scores, pass/fail, summaries)? If so:
  - Is there an **immutable audit log** of every evaluation, including the exact model output, model version, prompt version, and timestamp that produced it?
  - Can that log be produced in response to a legal discovery request?
- Are there safeguards against the model producing evaluations that **correlate with protected characteristics** — including name-based inference, accent detection from speech, or language register?
- Is the system compliant with applicable law?
  - EEOC guidelines (US)
  - Illinois AI Video Interview Act (if video/audio is used)
  - EU AI Act (if deployed in Europe — this system may qualify as a high-risk AI system)
  - GDPR / CCPA for data handling
- Is there a **mandatory human review step** before any candidate outcome is communicated or recorded?

---

### 8. PII & Data Lifecycle

- Is candidate PII (name, resume content, audio recordings, transcript) sent to third-party providers (OpenAI, ElevenLabs, Deepgram, etc.)? Under what **Data Processing Agreements**?
- Is audio from STT held in memory only, or is it written to disk or logs? When and how is it wiped?
- Do **application logs** contain raw candidate answers, names, or resume content? They must not.
- Is there a defined **data retention and deletion policy** — and is it enforced in code, not just documented?
- Can a candidate request deletion of their data (GDPR Article 17 / CCPA)? Is there a mechanism?

---

### 9. Latency & Real-Time UX

- Are LLM responses **streamed to the TTS engine**, or does TTS wait for full LLM generation to complete? This is a core UX bottleneck — document the actual architecture.
- Measure and document **p50 / p95 latency** for a complete turn (user speech ends → TTS playback begins).
- Are **independent API calls** within a turn parallelized (e.g., logging a turn while fetching the next question)?
- Is there a **conversational filler strategy** ("Let me think about that for a moment...") for turns where API latency exceeds a defined threshold (e.g., 2 seconds)?
- Is per-turn LLM and TTS latency tracked to a **monitoring system** (not just application logs)?

---

### 10. Concurrency & WebSocket Stability

- If the user speaks while TTS is playing, is the **interrupt/abort signal** handled cleanly without corrupting interview state?
- If a WebSocket disconnects and **reconnects within 30 seconds**, does the session resume correctly with no message duplication or dropped state?
- Are there **race conditions** between in-flight async operations (pending LLM call, pending TTS) and reconnect or abort handlers?
- Are WebSocket message handlers **idempotent**? What happens if the same event is delivered twice?

---

### 11. Observability & Debuggability

Given only the logs from a completed interview, a reviewer must be able to answer:

- Why was each question asked?
- Why did a specific claim evaluation pass or fail?
- Why did the interview end when it did?
- What exact prompt and model version were used for each turn?

Evaluate against these requirements:

- Are logs **structured (JSON)** with `session_id`, `turn_number`, `timestamp`, and `event_type` on every entry?
- Is there **distributed tracing** across LLM, TTS, and STT calls for a single turn?
- Is per-turn latency captured in the trace?
- Are errors reported to an **alerting system** (not just logged locally)?
- Can logs be queried efficiently per candidate and per session?

---

### 12. Testing & Deployment Hygiene

- Is there a **test suite for the state machine** covering all valid transitions, all invalid transitions, and all failure paths?
- Are LLM responses **mocked in tests**, or do tests call live APIs? Live API tests are a reliability and cost risk.
- Is there a **staging environment** that mirrors production configuration (same model versions, same prompts, same rate limits)?
- Are **feature flags** used to gate this system for controlled rollout — e.g., internal users only, then pilot cohort, then general availability?
- Is there a **rollback plan** if a prompt change degrades interview quality in production?

---

### 13. Demo vs. Production Gaps

Explicitly audit for the following. For each one found, state whether it is **reachable in a production deployment**:

| Pattern | Present? | Reachable in Prod? |
|---|---|---|
| `localStorage` used for session or auth state | | |
| Hardcoded credentials or API keys | | |
| Mock or stub data in non-test code | | |
| Frontend-only validation with no server mirror | | |
| `console.log` statements containing sensitive data | | |
| `TODO` / `FIXME` in critical control paths | | |
| Environment checks that default to permissive | | |

---

## Required Output Format

### 1. Critical Issues (Launch Blockers)

Must be fixed before any real user usage. For each issue:

```
File: path/to/file.ts, line N
Issue: [concise description]
Why it matters: [system-level impact]
Real-world failure scenario: [specific, concrete example with a real user]
Recommended fix: [specific, actionable]
```

### 2. Medium-Risk Issues

Not immediate blockers, but degrade reliability or expose future risk. Use the same format as above.

### 3. Missing Production Capabilities

Capabilities that are **entirely absent** — no implementation, no stub, no placeholder. List with a one-line description of the expected behavior and the consequence of it being missing.

### 4. Demo-Grade Components

Explicitly identify every part of the system that is not production-ready. Do not soften the language.

> Example: *"The session validation in `interviewRouter.ts` is demo-grade. It checks for the presence of a session token but does not verify ownership. Any authenticated user can access any session."*

### 5. Top 5 Fixes by Impact

Stack-ranked by risk reduction. For each, include:

- What to fix
- Why it has the highest impact
- Estimated engineering effort (in hours)

### 6. Final Verdict

Choose exactly one:

| Verdict | Meaning |
|---|---|
| `FAIL` | Do not deploy under any circumstances. |
| `CONDITIONAL PASS` | Pilot-only deployment acceptable with a defined set of required fixes. List them explicitly. |
| `PRODUCTION READY` | Safe to deploy with any remaining caveats noted. |
