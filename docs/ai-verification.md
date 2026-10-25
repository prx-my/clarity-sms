# Verification and remaining deployment work

Initial isolated verification ran on 2026-10-25. During the subsequent authorized setup, the additive AI tables were applied to the existing Neon database and one real, consented owner test call completed through Twilio ConversationRelay and Groq. Existing number routing was preserved; no SMS or calendar booking was sent.

## Checks

- 54 Node tests: policy/state rules, calling hours, consent evidence, preview contact integration, extraction/verified-field protection, model routing/context, provider credential isolation, precise Groq cache-rate accounting, cache-token accounting, effective prices, bundled speech, INR sourcing, budgets, interrupted streams and concurrent interruption events, disclosure retries, empty-update rejection, normal hangup classification, duplicate actions, failures, opt-outs, actual generated TwiML/signatures and preserved manual dialing.
- Embedded Postgres: both generated migrations apply; existing contacts and SMS survive; transcripts persist across reopen; foreign keys, reservation and idempotency constraints work; actual PostgresStore methods execute; concurrent status updates remain ordered; retention removes expired content and preserves usage/suppression.
- Five scripted scenarios: inquiry/qualification/booking, approved-link delivery, interruption, opt-out and human handoff use explicitly injected test providers. The generated `voice-simulation-report.json` states zero real calls.
- Headless browser: authenticated Calls → AI Agent loads; agent changes and workspace settings save; cost intelligence renders; 1440px desktop and 390px mobile inspected; no page JavaScript errors or mobile page overflow. Preview data was in memory only.
- Gateway entry point starts with AI disabled; health requires the shared secret and reports zero active calls. An unauthenticated health request returns 404.
- TypeScript, ESLint through Next's production build, and `git diff --check` are part of the final checks.

## Implemented

Additive Neon/Drizzle schema and migration, default/editable agent profiles, explicit inbound apply/restore, signed connect/status/action/transfer handlers, separate secure ConversationRelay gateway, streamed/cancelable OpenAI runtime, server-bound tool registry and durable side-effect keys, real optional Google Calendar adapter, real consented Twilio SMS and transfer adapters, live SSE transcript/tool panel, history/qualification outcomes, rate-card cost ledger and analytics, budgets, context/caching measurements, optional deterministic routing, experiment cohorts, retention control, tests, simulation and runbooks.

## Required for live acceptance

Supply OpenAI credentials and confirm account-visible chat/tool-capable models; enable Twilio ConversationRelay in the account; deploy the WSS gateway and public HTTPS application; apply the additive schema to the intended Neon database; configure actual rates; review/enable an agent; allowlist a consenting test recipient and record consent/timezone; optionally connect the agency calendar and approved messaging/transfer destinations. Then execute the real-call runbook and inspect actual audio, provider IDs and costs.

The local setup now has the existing Twilio/Neon configuration, a separately stored Groq API credential, a generated gateway secret and a public ngrok HTTPS/WSS endpoint. Twilio's existing AI/ML-enabled setting was verified in the account console. Provider credentials are never printed or committed. OpenAI remains an optional alternative.

## Live setup result

The owner explicitly authorized one call to their own allowlisted test number. Twilio reported a completed 70-second call. ConversationRelay persisted ten transcript messages, six caller turns and three interruptions. Groq streamed responses using an account-visible `openai/gpt-oss-20b` model. All baseline cost components were priced; the total estimate was USD 0.281086550. The finalized voice charge was still pending at verification time, so the estimate is not represented as an invoice.

The call outcome remained Unresolved: it did not establish a qualified sales lead or appointment. Two tool writes succeeded but contained no new lead fields; they are not evidence of useful qualification. Review of that real-call evidence led to server rejection of empty lead updates, improved cancellation labels, a disclosure retry after immediate interruption, and correct classification of a normal caller hangup. Those fixes have automated regression tests. No second phone call was placed to validate them acoustically because authorization was limited to one call.

New outbound calls were paused after the test. The app, gateway and tunnel run locally and require the Mac and processes to remain running. Permanent gateway hosting, calendar access and a further consented acceptance test remain separate from this local setup. Personal test-contact and Call SID records are stored only in Neon and ignored local runtime files, not this document.

## Deferred / limits

One admin and one concurrent real demo call; English US configuration; no distributed gateway ownership or booking lock across third-party calendar clients. Email, bulk outreach, AMD activation, recording, Media Streams, automatic retention scheduling, background reconciliation, full invoice imports/carrier fee reconciliation, number-rental allocation and automatic FX feeds are not implemented. Premium/economy voice labels do not imply lower prices when speech is bundled. Pricing examples require operator verification and effective rate cards. Real speech accuracy, audible latency, blinded quality and operating-cost savings remain unmeasured.

The fixed synthetic context fixture measured 29,777 baseline characters versus 10,440 optimized characters. This is a serialized-context measurement, not token billing or observed provider savings. See the generated report for the exact fixture description.
