# Poseidon Ledger — Production Abuse-Resistance Plan

The public tracer must never permit a single request to trigger unbounded recursive blockchain work.

## Core execution rule

A trace request processes a fixed batch of at most **10 new transactions**. If more downstream work exists, the response returns a continuation state and the user must explicitly request the next batch.

The production backend should preserve that rule server-side. Hiding results in the browser is not a resource control.

## Continuation model

- Server owns the trace state.
- Client receives an opaque, signed continuation token rather than choosing arbitrary recursion depth or work size.
- Each continuation request authorizes at most 10 new transaction analyses.
- Trace sessions expire after a bounded TTL.
- Duplicate TXIDs are suppressed.
- Breadth-first processing keeps split branches visible rather than allowing one branch to consume the entire budget.
- Frontier size and per-transaction output fan-out are bounded; oversized cases can be redirected to an offline/analyst workflow.

## DDoS and bot controls

Production deployment should layer controls rather than rely on one mechanism:

1. CDN/reverse-proxy/WAF protection in front of the origin.
2. Per-IP and per-session token-bucket rate limits for new traces and continuation requests.
3. Low burst allowance and bounded concurrent trace jobs per client/session.
4. Bot challenge/CAPTCHA after abnormal request volume or repeated expansion.
5. Worker queue with global concurrency limits so expensive traces cannot exhaust the web process.
6. Strict request timeouts, upstream timeouts and circuit breakers.
7. Input validation for TXID/address length and format; never accept arbitrary upstream URLs from users.
8. Cache confirmed transaction and outspend data to avoid repeatedly paying for immutable blockchain lookups.
9. Session TTL and maximum frontier size to prevent unbounded server memory growth.
10. Structured logging and metrics for rate-limit hits, queue depth, provider failures, trace latency and abuse patterns.

## Suggested production budgets

These are starting values to benchmark, not permanent constants:

- 10 new transaction nodes per trace/expand request.
- 1–2 concurrent trace jobs per anonymous client/session.
- Small burst allowance followed by token-bucket throttling.
- 5–10 second worker execution budget per request.
- 30–60 minute anonymous trace-session TTL.
- Challenge or stronger throttling after repeated expansions.

Authenticated analyst workflows can receive larger quotas without changing the evidence model.

## Provider protection

The backend should not blindly amplify requests to a public blockchain provider. Use local caching, request coalescing for identical TXIDs, provider-side rate-limit awareness and backoff. If the upstream provider is degraded, fail closed with a clear retry message rather than spawning additional retries.

## Custodial attribution safety

Service attribution must remain separate from culpability.

Each custodial boundary record should preserve:

- attributed service;
- confidence level;
- attribution source and last verification date;
- legal entity/jurisdiction when verified;
- public reporting/support route;
- law-enforcement request route where published; and
- evidence required for escalation.

Do not infer a customer identity from an exchange address and do not infer that an account holder committed the offence.
