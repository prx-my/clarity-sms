# Monitoring & Usage Intelligence

## Repository audit and integration plan

The existing application is Next.js 15.5 App Router / React 19 / TypeScript, styled with its own CSS and Radix primitives. Next route handlers are the backend. Drizzle uses Neon HTTP Postgres; tests use PGlite. Authentication is a signed, HTTP-only, single-admin session, enforced by middleware and route guards. There is no tenant system, job queue or general monitoring service. Monitoring therefore scopes every row to the single `workspace`; the authenticated admin is the only authorized viewer/exporter/configurator.

Twilio uses one configured account and number, not a subaccount inventory. SMS creation is `/api/messages`, inbound `/api/twilio/inbound`, and delivery `/api/twilio/status`. Browser calls use `/api/voice/outbound`; call history previously polled Twilio. At the initial audit, AI used ConversationRelay with a separate long-lived `scripts/voice-gateway.ts`, signed `/api/twilio/ai/*` hooks, OpenAI or Groq streaming chat completions, and durable `ai_*` session/event/tool/usage/rate tables. Existing AI SSE periodically reads persisted state. Existing Analytics is SMS-only. Dashboard deployment was Vercel with a separate Node gateway at that audit. Integration with current main also preserves its Vercel Fluid Compute relay mode and deployment safeguards.

Implementation adds monitoring tables through Drizzle, a lightweight event collector, asynchronous projection/accounting worker, bounded Twilio reconciliation/backfill, protected APIs, and a Monitoring navigation entry. Manual Dial TwiML gains child status callbacks and an action callback; existing SMS handlers gain sanitized telemetry. Existing AI records are imported incrementally by the worker without adding analytics/network calls to the conversation loop. New AI usage update timestamps make mutable duration measurements discoverable. Existing rates remain independent and are copied with immutable provenance into monitoring. No calls, messages, routing changes, production migrations or deployment are initiated by setup/tests.

The installed Next package does not contain the `dist/docs` directory mentioned by the inherited AGENTS instructions. Implementation follows the installed Next 15 types and existing route conventions.

## Engineering report

### Implemented

- Dedicated `/monitoring` workspace with Overview, Calls, Messaging, AI Usage, Costs, System Health and Alerts tabs; custom periods, explicit display timezone, filtering, paginated tables, details/timelines and secure CSV export.
- Durable validated, sanitized events and asynchronous database-backed projection. Stable callback keys, monotonic status ranks, per-resource measurements, retries/backoff and worker leases prevent duplicate accounting. SQL queries choose the latest ledger entry per measurement and charge kind, rather than summing historical corrections.
- Separate immutable charge records for estimates, reported resource prices and reconciled resource prices, plus billing differences. Fixed-point arithmetic uses 12 decimal places; prices stay in original currencies. Missing quantities/rates use null. `XXX` means the original currency is not yet known. INR conversions require a sourced, timestamped exchange-rate version; no default FX rate is embedded.
- Versioned, sourced rates, pinned once selected for a usage identity. Existing AI rates are imported with their provenance; existing per-message AI SMS prices are not silently treated as segment prices. The demo voice rate is country scoped; operators must use their actual applicable destination/account pricing.
- Browser Dial TwiML now supplies child-leg progress callbacks and an action callback. Signed dedicated voice callbacks return 503 when persistence fails so retries/recovery are possible. The TwiML control path catches telemetry errors and bounds its database wait. Parent/child legs retain their own usage and prices and share an interaction identifier.
- Existing SMS creation, inbound and delivery hooks record actual provider records. Sent is separate from delivered. Provider segments take precedence; GSM-7 extension characters and Unicode multipart estimates are labeled estimated. Initial creation and historical callback records are also imported incrementally from the original persistent tables. No full message content enters monitoring events.
- Incremental AI imports reuse actual sessions/events/usage, including interrupted requests, tool timing, caller/assistant turn counts and business outcomes. Gateway voice-duration estimates are replaced by signed/provider duration. Model request IDs and first content token timing are captured by the installed streaming SDK. Failed/incomplete streaming usage is null in the monitoring ledger, even where the original AI store uses a zero placeholder with an incomplete flag. Reasoning token counts are informational subsets of output tokens and are not billed a second time.
- ConversationRelay is one bundled service. Standalone STT/TTS estimates are zero only when explicitly marked bundled; unsupported speech detail is unavailable. No audible first-speech measurement, packet loss, jitter or MOS is fabricated.
- Bounded Twilio resource reconciliation, delayed-price retries, rate-limit backoff, job audit/status, and incremental provider-page backfill. Phone-number daily UsageRecords are imported as unallocated account charges every six hours, excluding subaccounts. Aggregate total/calls/SMS categories are not summed over per-resource prices.
- Configurable financial, token, latency, volume, segment, failure, no-answer, tool, socket, queue and reconciliation rules with minimum samples, deduplication, cooldown, acknowledgment and resolution. UTC day/month budgets support workspace, provider, agent and campaign scopes and only create alerts.
- Deterministic messaging optimization recommendations include a minimum sample size, evidence, period, limitations and trade-offs; no savings or automatic operational changes are claimed.
- Actual database/gateway probes, worker heartbeat, pending/failed projection counts, error distributions and job history. Health never infers uptime from an absence of errors.
- Single-admin authorization at every monitoring endpoint, mutation origin checks, database-backed request limits, source account checks, canonical-URL Twilio signature validation, redacted webhook metadata, transcript access through the existing protected AI API, admin audit events, formula-safe CSV, and scheduled retention/redaction that preserves source financial evidence.

### Database changes

`drizzle/0002_yellow_bucky.sql` adds `monitoring_events`, `monitoring_resources`, `usage_measurements`, `cost_ledger_entries`, `provider_rate_cards`, `billing_adjustments`, `billing_reconciliation_runs`, `monitoring_sync_checkpoints`, `monitoring_alert_rules`, `monitoring_alert_instances`, `monitoring_budgets`, and `monitoring_exchange_rates`. It adds `ai_call_usage.updated_at` so mutable duration updates can be imported. The migration includes unique idempotency keys, time/resource/session/pending-work indexes, numeric/check constraints and financial source foreign keys. Existing SMS/contact/AI records are preserved. There is no duplicate provider database and no separate broker.

For this small deployment, indexed SQL performs daily aggregations. A separate `monitoring_daily_aggregates` table/materialized summary is deliberately deferred until observed scale justifies it. Financial values come from the usage/charge ledger; events are operational evidence.

### Files created

- `src/db/monitoring-schema.ts`, `drizzle/0002_yellow_bucky.sql`, `drizzle/meta/0002_snapshot.json`.
- `src/lib/monitoring/{model,money,store,bridge,messaging-bridge,providers,reconcile,queries,alerts,worker,http}.ts`.
- `src/app/api/monitoring/[...path]/route.ts`, `src/app/api/twilio/monitoring/{voice,dial}/route.ts`.
- `src/app/(app)/monitoring/page.tsx`, `src/components/monitoring-workspace.tsx`.
- `scripts/{monitoring-worker,setup-monitoring,monitoring-live-test,verify-monitoring,check-monitoring}.ts`, `tests/monitoring.test.ts`, and this report.

### Existing files modified for this module

`src/db/schema.ts` exports the monitoring schema and adds the AI usage timestamp. `src/lib/ai/store.ts` updates that timestamp. `src/lib/ai/llm.ts` and `runtime.ts` capture request/latency/error metadata. `src/lib/ai/tools.ts` observes existing SMS side effects. `src/lib/twilio.ts` binds webhook validation to the configured origin/account. Existing SMS and voice routes, AI status/transfer routes, navigation, CSS, package scripts, environment example, README, and migration journal are extended. Manual dialer and database regression tests are updated for additional TwiML attributes/the new migration. Pre-existing uncommitted AI work was preserved.

### Integrated provider endpoints and timing

| Data | Source | Timing and financial meaning |
| --- | --- | --- |
| Call lifecycle/legs | Twilio signed status callbacks and Dial action | Callback time + worker projection, after the next bounded worker pass; backlog and database latency affect delay |
| SMS lifecycle | Existing signed inbound/status callbacks, Message creation result | Callback time + worker projection; delivery can be delayed by the carrier |
| AI sessions, tools, tokens | Existing durable AI records; OpenAI/Groq stream usage | Incremental import each worker tick; canceled streams may lack usage |
| Live AI duration | Gateway elapsed duration | Estimated; not a provider billable-duration assertion |
| Voice/SMS resource price | Twilio `/2010-04-01/Accounts/{AccountSid}/Calls/{Sid}.json` and `Messages/{Sid}.json` | Periodic, delayed; null stays pending |
| Number rental/account costs | Twilio daily UsageRecords `category=phonenumbers`, `includeSubaccounts=false` | Every six hours, unallocated to individual interactions |
| Prices | Operator-sourced effective rate cards / existing source rates | Estimated, versioned and traceable |
| INR | Operator-supplied sourced FX versions | Presentation conversion; original currency is preserved |
| UI refresh | SSE observing durable backend revisions | Five-second revision check; no per-second provider billing polling |

Twilio resource `Price` debit signs are normalized to expense signs while the original signed value remains in the source event. UsageRecords expense prices retain their documented convention. Reconciled means matched to a provider resource/usage record, not certified against a final invoice. The matched estimate difference excludes pairs with missing estimates or different currencies.

### Known limitations and deferred features

- One admin and one configured workspace/account, matching the application. No multi-tenant/RBAC/subaccount management was introduced. All authenticated users currently have the admin role, including permission to explicitly load a transcript.
- Existing inbound AI routing is observed. Other inbound manual call routing must have its status callback configured to `/api/twilio/monitoring/voice`; monitoring does not take over number routing.
- No automatic FX feed, complete invoice import, carrier surcharge inventory, enterprise observability backend or provider Voice Insights subscription integration. Account number rental is imported; other unsupported account fees remain outside the available total. Prices/segments may remain unavailable until Twilio exposes them.
- Country-scoped voice/message rates are explicit pricing assumptions, not network-specific invoice guarantees. Browser/client legs require their own matching provider-native direction/country rate; if no reliable rate matches, they remain unpriced. Recording/quality fields can be admitted as real events but are not fetched by an additional Insights/recording crawler.
- Unexpected-spend baselines, advanced campaign/provider experiments, automatic provider/model changes, distributed workers/gateway ownership, external notifications and archive-tier storage are deferred. Current insights are deterministic messaging rules.
- Logical interaction IDs connect known call legs, AI sessions and observed AI SMS follow-ups. Missing campaign/agent/contact linkage remains Unattributed; there is no guessed attribution.
- The collector bounds control-path persistence waits; signed callback failures are retryable and original persistent SMS/AI records are recoverable. If both local storage and provider callback delivery fail, provider backfill is required. Database outages cannot persist an alert into the same unavailable database; the health API/host logs expose that failure.
- Worker execution is required. The existing Vercel deployment can host the AI relay in its supported Fluid Compute mode, but does not run this continuous monitoring worker. Use a long-lived Node process, or schedule `monitoring:once` externally at a suitable cadence. No unrelated automation service was created.
- Detail pages cap timeline/usage/ledger payload sizes (reported in the response). CSV export is capped at 1,000 rows. Increasing volume should prompt keyset pagination/materialized summaries and stronger lease heartbeats before multi-worker scaling.
- Transcript retention follows the existing AI policy; monitoring event retention separately redacts phone fields and keeps accounting evidence. This is not a legal deletion/financial retention policy.

Live acceptance and the final validation record are documented in [monitoring-testing.md](monitoring-testing.md). Browser visual QA remains unverified because local browser use is disabled; authenticated HTTP and provider/database checks completed.

## Integration with current main

The merge retains main's Node 22 engine, dependency security overrides, production environment guards, atomic relay ownership, Vercel/standalone gateway modes and CI audit/container checks. Monitoring health probes `/api/twilio/ai/health` in Vercel mode and `/health` in standalone mode. Monitoring usage timestamps and instrumentation are layered onto the current AI runtime/store without reverting its deployment fixes.

Post-integration validation passed all 84 tests, the synthetic scenarios, TypeScript and the production build. The production-only dependency audit reported zero vulnerabilities. The merged code retains all existing gateway/deployment regression tests and adds a Vercel monitoring-health regression test.
