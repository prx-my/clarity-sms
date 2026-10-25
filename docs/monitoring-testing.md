# Monitoring setup and demo runbook

## Safe local verification

```bash
npm test
npm run typecheck
npm run build
```

Tests use fresh PGlite databases in memory/temporary directories. They exercise the actual migrations, Drizzle projectors, signed callback handler, protected APIs and deterministic provider fixtures. They never contact Twilio, send SMS, place a call or write to Neon. Fixtures are isolated from application storage; application ingestion refuses explicitly tagged test telemetry outside test mode.

## Database setup

For a fresh database tracked by the existing Drizzle journal, apply `npm run db:migrate` after setting the existing environment variables. For a running database initialized through `db:push` or the previous manual AI setup, use `npm run monitoring:setup` to inspect and then `npm run monitoring:setup -- --apply`. This guarded command applies only migration 0002 in one Neon transaction, refuses partial installations and reports when already applied. It does not recreate existing tables or reset migration history.

The monitoring migration adds twelve tables and `ai_call_usage.updated_at`. Back up important data and choose one migration strategy; do not replay the original migration over an existing untracked schema.

## Runtime setup

1. Set the existing `DATABASE_URL`, `APP_URL`, Twilio credentials, number, admin password and session secret. `APP_URL` must exactly match the public HTTPS webhook origin, including through a tunnel.
2. Start the application as usual. AI additionally needs its existing enabled gateway, Groq/OpenAI credential, ConversationRelay onboarding and WSS configuration.
3. Start `npm run monitoring:worker` alongside the gateway on a long-lived Node host. The worker processes small bounded batches, imports existing records, reconciles every five minutes and runs retention daily. A historical backlog may require several passes. `npm run monitoring:once` processes one pass and exits.
4. Sign in and open Monitoring. Empty/unavailable states are honest; no sample events are inserted into the production dashboard.
5. In Costs, add effective sourced rates that match provider, service and model/country. Example service identifiers: `voice_outbound`, `voice_inbound`, `sms_outbound`, `sms_inbound`, `mms_outbound`, `conversation_relay`, `llm_input`, `llm_cached_input`, `llm_output`. Use lowercase provider names. Voice/message country models are ISO country codes when reliably available. The selected rate and original usage identity are preserved for audit.
6. Add a sourced timestamped INR conversion if desired. Without one, conversion stays unavailable. Configure alert rules and budgets in Alerts; no outbound restrictions are added by monitoring.
7. Existing manual outgoing calls get child callbacks and a Dial action automatically. Existing SMS hooks and AI hooks are observed. For an independently routed inbound manual call, configure its Twilio status callback to `/api/twilio/monitoring/voice`, retaining the existing inbound routing URL.

## Real Twilio acceptance test

Use only a destination whose owner explicitly consented to the particular call and SMS. Trial/region/carrier restrictions may reject a request. A message accepted by Twilio is not proof of delivery. Do not automatically repeat an uncertain provider request.

The optional `scripts/monitoring-live-test.ts` uses the existing dedicated owner AI test profile, recorded consent and destination allowlist. It requires the local app at port 3100 and a healthy existing public gateway. It creates an exclusive ignored local guard before provider side effects and restores the previous agent/pause settings afterward. It sends exactly one message through `/api/messages` and requests exactly one AI session through `/api/ai/sessions`. It does not change number routing, calendar access or the messaging opt-out state.

```bash
# Only after the human has explicitly authorized that destination and both actions:
node --import tsx scripts/monitoring-live-test.ts --to=+COUNTRYCODE_NUMBER
node --import tsx scripts/verify-monitoring.ts
```

An existing `.ai-local/monitoring-live-test.json` prevents another invocation. Never delete that guard merely to retry; inspect Twilio and the stored IDs first, and obtain authorization for any additional call/SMS. These ignored files contain provider references and the consented test number; keep them private.

Verify the following:

- Answer the phone and speak to the AI. Confirm disclosure, normal hangup and any business outcome separately from provider connection success.
- In Monitoring → Calls, inspect native status events, duration and each billable leg. In the detail view, inspect the timeline, AI events, token usage and estimate provenance.
- In Messaging, inspect the sent/delivered/failed status, real provider segment count and error code. Confirm on the receiving device if delivered.
- Run a worker pass or wait for the continuous worker. Inspect reconciliation jobs; null prices stay pending. Provider Call/Message prices may arrive later. Resource prices exclude unsupported invoice/account charges.
- Replaying the same signed callback must leave one usage measurement and unchanged financial totals. Integration tests exercise this without contacting a provider.
- Confirm that the original Inbox and manual Calls page remain accessible and the original dialer's `<Dial>/<Number>` behavior is preserved.
- Reopen the application/processes; events and ledger data must remain in Neon.

## Historical recovery and troubleshooting

System Health → Historical recovery imports one provider page for the chosen dates. Repeat the same kind/window to resume its persisted next-page cursor. Calls use start-time filters; messages use sent-date filters, so unsent historical messages may require direct resource reconciliation. No historical token usage is invented. Importing a page does not send a call/message or overwrite newer status with a lower lifecycle state.

System Health shows the actual database/gateway probes, worker heartbeat, queue, failures and reconciliation runs. A stale worker needs its host process restarted. A failed provider synchronization backs off and remains visible. Failed financial projections remain pending with retry counts. A serverless-only deployment needs an external scheduler/worker host. A full database outage can only be reported through the live health response/host logs until persistence returns.

Retention defaults to 90 days for nonfinancial event detail and phone fields; rate versions, usage, ledger entries and financial source evidence remain. Existing AI transcript retention is separate. For a regulated deletion request, review accounting retention requirements rather than deleting source evidence ad hoc.

## Verification performed on 25 October 2026

- The guarded additive monitoring migration was applied to the configured Neon database. Existing application tables were retained.
- The user explicitly authorized one call and one SMS to the test destination in this chat. Exactly one of each was requested; the exclusive local guard remains in place.
- Twilio reported the AI call completed with an 85-second duration. The original AI runtime stored 14,094 input tokens (including cached input) and 443 output tokens. An interrupted/incomplete request retains unknown usage; no extra consumption is invented. The saved business outcome was **Unresolved**, not a qualified lead or booking. Twilio later supplied 83 seconds of ConversationRelay service usage, separately from the 85-second call duration; that value replaces the earlier live speech-service estimate.
- Twilio reported the SMS **delivered**, with **one provider-reported segment** and no error code. Local message status matched the provider. The message body is not stored in general monitoring telemetry.
- The monitoring call resource and AI session reached completed; the message reached delivered. Their detail timelines and usage records persisted in Neon; projection failures were zero. Existing stored historical AI/SMS records were imported rather than replaced with synthetic data.
- Provider Call and Message resource prices were still null at the observed checks. They remain pending, separate from versioned estimates. No exchange rate was configured, so INR presentation correctly remained unavailable.
- The final production build, TypeScript, and all **72 tests** passed. The actual authenticated Monitoring page returned 200; Overview, Calls, Messages, AI, Costs, Health, Settings and Reconciliation APIs returned 200; an unauthenticated monitoring request returned 401. Health showed reachable storage and zero failed projections.
- Automated visual browser inspection could not run because local browser access is disabled in Work settings. The page's server response/navigation and real APIs were verified; no visual QA result is claimed.
- The local application was started on its existing port 3100, the updated ConversationRelay gateway on 3001, and the monitoring worker alongside them. These are local processes, not permanent hosting. The test profile and outbound-pause setting were restored after the authorized calls were created. No further call or SMS is authorized by this report.

Private provider IDs, the destination number and detailed machine-readable verification are stored only in ignored `.ai-local/monitoring-*.json` files. Public project documentation omits those identifiers and all credentials.
