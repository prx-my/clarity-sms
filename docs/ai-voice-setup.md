# AI voice setup, deployment and tuning

## Architecture

The existing Next.js browser dialer, SMS inbox, contacts, authentication and Neon database remain the foundation. Contacts are lead identities. AI uses additional tables from `src/db/schema.ts`; it does not migrate or replace existing records.

The Next.js app creates consented calls, returns TwiML, receives signed callbacks, and serves authenticated JSON/SSE dashboard updates. A **separate persistent Node process** runs ConversationRelay WebSockets. Both share Neon and configuration. No Redis is needed for the enforced single concurrent real demo call. In-memory storage is only used in explicit `DEMO_MODE=1` and injected tests; a database error never silently switches a live call into memory.

ConversationRelay does STT/TTS. The gateway sends text, not audio, and uses OpenAI streaming tool calls for decisions. There are no external ElevenLabs API calls. `VoiceTransport` is the extension point for a future Media Streams implementation; no second audio pipeline has been implemented.

### Groq provider

The LLM adapter also supports Groq through its official OpenAI-compatible endpoint. Set `AI_LLM_PROVIDER=groq`, `AI_LLM_MODEL=openai/gpt-oss-20b`, and `GROQ_API_KEY` in local server configuration. Select Groq on the agent profile; credentials remain separate from OpenAI. Reasoning effort and output limits are configurable. The owner-test profile uses low reasoning effort and a 768-token generation limit while retaining the concise speech policy. Provider-only OpenAI fields such as `store` and `prompt_cache_key` are omitted on Groq requests; automatic cached-token usage is still recorded. Models are verified against the account's model list, never inferred from a similarly named model on another service.

Sources verified during setup: [Groq compatibility](https://console.groq.com/docs/openai), [available models/prices](https://console.groq.com/docs/models), and [prompt caching](https://console.groq.com/docs/prompt-caching). The cached-token rate uses the documented 50% discount. Rate cards support up to twelve decimal places; monetary totals retain decimal-safe billionths of USD.

## Database

Back up the target database before deployment. The generated additive migration is `drizzle/0001_yellow_bromley.sql`. The local embedded Postgres test applies both migration files, checks existing SMS preservation, foreign keys, durable reservations, idempotency constraints and persistence after database reopen.

- **Existing Clarity installations originally set up using `db:push`:** use `npm run db:push` against the intended database and review the proposed additive schema changes. The existing README used push, so those installations may not have a Drizzle migration journal. Do not blindly run historical `0000` CREATE TABLE statements over an existing installation.
- **New databases or databases already managed with Drizzle migrations:** use `npm run db:migrate`. The script loads `.env.local` and applies the journal with Drizzle's Neon HTTP migrator.
- The tests do not apply migrations to the configured Neon database. Deployment remains an operator step.

New tables: `ai_agents`, `ai_lead_memory`, `ai_settings`, `ai_call_sessions`, `ai_conversation_messages`, `ai_tool_executions`, `ai_call_usage`, `ai_lead_qualifications`, `ai_call_events`, `ai_rate_cards`.

## Configure two processes

Copy `.env.example` and preserve existing Twilio, Neon, login and browser-token variables. Set:

```text
AI_VOICE_ENABLED=1
OPENAI_API_KEY=<secret>
OPENAI_MODEL=gpt-4.1-mini
APP_URL=https://application.example.com
AI_WEBSOCKET_PUBLIC_URL=wss://gateway.example.com/relay
AI_GATEWAY_PORT=3001
AI_GATEWAY_SECRET=<different random secret, at least 32 characters>
AI_DEMO_ALLOWED_NUMBERS=<exact consented E.164 test numbers, comma-separated>
AI_CONVERSATION_RELAY_ACKNOWLEDGED=1
```

Generate the gateway secret with `openssl rand -hex 32`. Store secrets in the host's secret manager or protected environment; never commit them. Use the same gateway secret and provider/database configuration on both processes. Keep `DEMO_MODE` unset for live operation.

Run:

```bash
npm run dev           # terminal one: Next.js
npm run voice:dev     # terminal two: persistent gateway
```

For local phone testing, expose **both** ports through separate trusted TLS tunnels. Set `APP_URL` to the HTTPS app tunnel and `AI_WEBSOCKET_PUBLIC_URL` to the WSS gateway tunnel ending in `/relay`. Twilio signature validation uses the configured public URLs, including the exact query string; forwarded/Host headers are not trusted to construct AI webhook URLs. The gateway validates Twilio's handshake signature and a short-lived session/Call SID ticket. It accepts WSS and HTTPS representations of the configured handshake URL for TLS proxies. Preserve the original request path and signature headers through your proxy.

Alternatively, set `AI_PROXY_APP_URL=http://127.0.0.1:3100`, run Next on port 3100 and the gateway on 3001, then expose gateway port 3001 through one TLS tunnel. The gateway proxies regular HTTP to the fixed loopback app and handles `/relay` itself; `/health` remains secret-protected. Set `APP_URL` to that public HTTPS origin and `AI_WEBSOCKET_PUBLIC_URL` to the same origin with `wss://` and `/relay`. The app's authentication still protects dashboard/API access. The tunnel and both Node processes must stay running; this is a local demo arrangement, not permanent gateway hosting.

Deploy the app normally (`npm run build`, `npm start`, or existing Vercel project). Deploy the gateway to a long-lived Node 22+ service with TLS termination, WebSocket upgrade forwarding and graceful SIGTERM handling. Install dev dependencies or compile/package the gateway in your deployment image: the supplied gateway command uses `tsx`. Persistent gateway hosting, monitoring and secrets management are deployment responsibilities, not included infrastructure provisioning.

## Twilio configuration

1. In Twilio Console, complete [ConversationRelay onboarding](https://www.twilio.com/docs/voice/conversationrelay/onboarding), including the AI/ML addendum. An environment acknowledgment does not prove account entitlement. Public docs cannot verify this particular account.
2. Keep the manual TwiML App URL `/api/voice/outbound` and SMS webhook `/api/twilio/inbound` unchanged.
3. In Calls → AI Agent → Agents, edit the default Schrader profile and enable it. Review all business claims, approved knowledge, hours, qualification questions, allowed tools, transfer destination and follow-up text. The server always adds AI/company disclosure.
4. Use **Verify providers** in AI Settings. It checks a secret-protected gateway health endpoint and lists OpenAI account-visible models. Model availability in the account is not inferred from public docs; unsupported chat capabilities may still produce a documented provider-error recovery during the real test.
5. Outbound calls use the existing Twilio number and per-call connect/status callbacks automatically. Every outbound call requires an existing allowlisted contact, a stored evidence-bearing consent record, caller-local operating hours, no opt-out, enabled agent, effective baseline rate cards, active budget and live readiness. Confirm each call in the UI. Attempts are limited to three per minute with ten seconds between attempts, in addition to the durable active-call reservation. There is no bulk dialer.
6. To enable inbound, save an inbound agent and answering mode, then click **Apply saved AI routing to Twilio**. It snapshots the purchased number's voice URL, method and TwiML App SID before changing routing. It resolves a prior TwiML App's voice URL for non-AI caller fallback. SMS and global number status callbacks are not changed. A per-call status callback is attached to AI inbound calls.
7. **Restore original routing** writes the captured original voice URL/method/App SID back to Twilio. The default mode is normal. With allowlist mode, other callers redirect to the captured handler. With AI disabled/unavailable, calls receive the previous routing or a brief honest fallback if no previous handler exists.

Do not configure the AI inbound URL as the SMS webhook. If previous routing was not a redirectable webhook (for example, custom externally managed Studio routing), verify the saved/resolved route in your Twilio console before the demo. Routing changes are explicit operator actions; tests never apply them.

## Agent tools and integrations

Tools have Zod input/output validation, session-bound lead access, permission rules, timeouts, event audits and durable semantic idempotency keys. A pending/unknown external side effect is never automatically retried. A provider network error can mean an action occurred without confirmation; the system records unknown and requires operator reconciliation.

| Tool | Actual behavior |
| --- | --- |
| `lookup_lead` | Reads only the session contact's known facts; cannot query another lead |
| `update_lead` | Requires caller transcript evidence containing supplied values; fills unknown attributes and protects existing verified facts |
| `save_qualification` | Stores evidence IDs, summary, attributes and validated outcome; booking success requires a real booking audit |
| `check_calendar_availability` | Queries Google free/busy and offers 30-minute slots within agency hours, at most seven days ahead |
| `book_appointment` | Requires exact offered slot-label confirmation by the latest caller message, fresh offer, immediate availability recheck, and deterministic Calendar event ID |
| `send_demo_link` | Sends the approved HTTPS demo URL through Twilio SMS after explicit permission; no model-supplied recipient or URL |
| `send_followup` | Sends configured SMS text after explicit permission; email returns unavailable |
| `request_human_transfer` | Redirects the active Twilio call to trusted `<Dial>` TwiML; records initiation separately from human answer result |
| `mark_do_not_call` | Immediately sets the existing contact suppression flag; normal fact/consent updates cannot clear it |
| `end_call` | Requests safe Twilio call completion; signed callbacks reconcile final transport state |

Calendar access is optional. For actual bookings, configure a dedicated agency Google Calendar and OAuth credentials in `GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Authorize `calendar.events` and `calendar.freebusy` scopes. The server refreshes access tokens as needed and uses the official [free/busy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) and [event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) APIs. Without these credentials, availability is unavailable, never fabricated. The current booking creates a calendar event containing the caller's authorized phone; it does not invent an email invitation, conferencing URL or attendance confirmation. Calendar free/busy plus insert is not an atomic slot lock against other calendar clients; use a dedicated booking calendar and review concurrent edits.

SMS must be explicitly enabled in the profile and permitted by the caller. Queued/accepted messages are reported as accepted for delivery; only a provider delivery result is delivery confirmation. Existing SMS callbacks continue to update Inbox message history. Unknown SMS segment counts are flagged; carrier fees and final delivery prices require authoritative billing reconciliation.

Recording is disabled. No voice payment, card, password or authentication-secret collection is supported. Caller transcripts, lead notes, and retrieved knowledge are untrusted data. Server-bound tools prevent arbitrary HTTP requests, code execution and cross-contact access. Prompt instructions and sentence-level result checks reduce unsupported success claims; generative behavior still requires real-call evaluation.

## Cost engine and rate cards

All monetary math uses integer billionths of USD; decimal strings cross API/database boundaries. Estimates are separate from finalized Twilio Call resource charges. Rate cards carry provider, category, exact model or destination country, unit, effective timestamp, source, bundled flag and billing increment. Appending new versions does not mutate prior cards; the per-call breakdown includes the IDs and sources used.

There are **no silently seeded universal rates**. Add reviewed rates in AI Cost Intelligence before real testing. Missing components are shown as unpriced; zero/partial cost is not a full bill. US Twilio voice rates apply only to `model: "US"`, not every allowed international number. Transfer legs require their own `twilio_transfer` country rate.

Examples to verify against your actual account and source pages on deployment:

| Category | Model/country | Unit | Example USD/unit | Source |
| --- | --- | --- | --- | --- |
| `conversation_relay` | empty string | minute | `0.07` | [Twilio conversational AI pricing](https://www.twilio.com/en-us/products/conversational-ai/pricing) |
| `llm_input` | `gpt-4.1-mini` | token | `0.0000004` | [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini) |
| `llm_cached_input` | `gpt-4.1-mini` | token | `0.0000001` | Same model pricing |
| `llm_output` | `gpt-4.1-mini` | token | `0.0000016` | Same model pricing |

These are dated configuration examples, not permanent contractual prices. Verify geography, selected provider/voice, Twilio account discounts and billing increments. Relay rate increments are configurable; the UI example uses a conservative 60-second increment. No separately bundled STT/TTS charge is added. Reasoning token details are retained inside output usage and never billed a second time. Cache-read input is subtracted from uncached input. Cache-write costs can be recorded as a separate category if a future API/provider exposes them; the current adapter does not invent cache writes. Interrupted streams may not return final token usage: those requests are explicitly marked incomplete rather than claimed free.

Live duration comes from gateway elapsed time until signed Twilio callbacks/reconciliation replace it. Relay duration comes from the documented Connect action's SessionDuration where available. Additional transfer legs and SMS usage are ledger components. Recording and other feature charges can use the same ledger but are not enabled by default. Number rental allocation is deferred.

Click **Reconcile Twilio duration & price** on an ended session to read the Call resource and record finalized voice charges where Twilio exposes them. Full invoice import, finalized relay/STT/TTS/SMS reconciliation and carrier surcharges are deferred. Provider invoices remain authoritative. Do not compare a partial finalized voice charge against the full estimated system bill.

INR conversion is disabled until a workspace `exchangeRate` has an explicit decimal `usdInr`, HTTPS source URL and ISO `asOf` timestamp. No live FX feed is assumed. UI warns through source/timestamp information; operators must refresh rates themselves.

## Optimizations and budgets

All five profile flags are independently reversible for **new** calls; sessions snapshot their profile:

- `compactContext`: stable prefix + current lead/session facts + 12 recent messages + up to 12 earlier caller excerpts + durable booking/message commitments and recent unresolved tool results. Complete transcript remains persisted separately. No summary LLM call is added. No statement is treated as verified solely because it appears in an excerpt.
- `conciseResponses`: one question and usually one or two useful sentences per turn.
- `promptCacheKey`: consistent system/tool prefix and stable agent cache key; usage records actual cached tokens. Automatic provider caching may still occur with this flag off. Turning off a cache key does not guarantee a cache-free baseline. No paid prewarming or extended retention is enabled. See [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
- `adaptiveRouting`: off by default pending quality benchmarks. Deterministic escalation uses prior validation/tool failure, long questions, and explicit complexity keywords. No second classifier model. Operator chooses economy and escalation models that the readiness check can verify. Two repeated failures offer a human/callback fallback.
- `toolCache`: reuses read results for a short window (availability 30 seconds, lead reads five minutes). Booking always rechecks availability. Side-effect idempotency is mandatory and cannot be disabled.

Voice tiers are comparison labels; actual provider and voice IDs select Twilio-supported voices at session setup. There is no unsupported mid-call voice switch and no assumed premium/economy savings when Relay bundles costs. Test voice quality and account pricing before assigning tiers.

Workspace budgets include daily/monthly thresholds, warnings/administrator dashboard events, future-turn economy routing, and pausing new outbound calls. Agent budgets include expected per-call/per-minute costs, token warning, LLM request and tool execution limits. Budget warnings never silently disconnect an active call. Duration limits provide a warning/fallback before the end; opt-out handling remains available after all normal limits. Budget decisions use recorded estimates; incomplete pricing is not an enforceable dollar ceiling. Configure all rates and watch actual provider spend.

Experiments alternate real calls between baseline/optimized agent profiles using workspace experiment settings. Cohorts record their actual selected configuration. No synthetic audio results or speculative percentage savings appear in real analytics. The simulation report compares serialized context size on a fixed synthetic transcript, not actual tokens, audio quality or observed provider savings.

## Retention, failure recovery and limits

The explicit authenticated prune control deletes expired completed-call transcript, tool, event and qualification payloads, clears session memory, and keeps billing/session aggregate metadata and contact consent/suppression. Run this operator action on schedule through your deployment scheduler if automatic retention is required; no scheduler has been provisioned. Restrict DB and dashboard access to authorized operators. Neon/provider encryption-at-rest and transport TLS should be enabled in the deployment; no bespoke key management system is added.

A call creation timeout is uncertain: the database reservation is kept so a retry cannot duplicate a live call. Signed callbacks can still bind the Call SID. A call with a known SID can be reconciled/end-requested from the dashboard. A missing-SID reservation needs operator inspection of the exact session webhook URL in Twilio logs before a manual database repair; the app deliberately does not guess a call from telephone number alone. Gateway crashes rely on Twilio disconnect/action callbacks and provider time limits; the watchdog is not a distributed job queue.

The MVP has one admin and one concurrent real AI call. Multi-workspace tenancy, multi-instance gateway ownership, distributed booking locks, generalized OAuth onboarding, email, automatic answering-machine detection, full invoice imports, background reconciliation, automatic retention scheduling, call recording and Media Streams are deferred. Voicemail status is honored if Twilio supplies AnsweredBy; AMD is not enabled and adds no hidden charge.

The original Next 15.5 install does not ship the newer `node_modules/next/dist/docs` directory referenced by the ancestor AGENTS instructions. Implementation used the installed SDK types and verified Next 15 route-handler documentation via Context7 instead.

## Real-call acceptance

Unit/integration tests and preview UI are not a phone call. Before calling this live-demo complete, perform all five scenarios in `ai-demo-script.md` on the actual enabled Twilio account, confirm at least one genuine persisted tool action, assess audio and interruptions, inspect accurate callbacks/outcomes, and reconcile the resulting costs. Live provider access, public TLS hosting and operator-supplied consent are required; none are fabricated by the local test harness.
