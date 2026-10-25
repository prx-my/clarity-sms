# Verification and remaining deployment work

Initial isolated verification ran on 2026-10-25. During the subsequent authorized setup, the additive AI tables were applied to the existing Neon database and one real, consented owner test call completed through Twilio ConversationRelay and Groq. Existing number routing was preserved; no SMS or calendar booking was sent.

## Checks

- 65 Node tests pass under Node 22: policy/state rules, calling hours, consent evidence, preview contacts, extraction protection, provider isolation, precise cost math, budgets, interruptions/disclosure retries, empty-update rejection, normal hangup classification, duplicate actions, failure recovery, opt-outs, generated TwiML/signatures, preserved manual dialing, production URL guards, honest readiness, atomic cross-instance socket ownership, Vercel call-duration caps, and malformed/unauthenticated socket rejection.
- Embedded Postgres: both generated migrations apply; existing contacts and SMS survive; transcripts persist across reopen; foreign keys, reservation and idempotency constraints work; actual PostgresStore methods execute; concurrent status updates remain ordered; retention removes expired content and preserves usage/suppression.
- Five scripted scenarios: inquiry/qualification/booking, approved-link delivery, interruption, opt-out and human handoff use explicitly injected test providers. The generated `voice-simulation-report.json` states zero real calls.
- Headless browser: authenticated Calls → AI Agent loads; agent changes and workspace settings save; cost intelligence renders; 1440px desktop and 390px mobile inspected; no page JavaScript errors or mobile page overflow. Preview data was in memory only.
- Gateway entry point starts with AI disabled; health requires the shared secret and reports zero active calls. An unauthenticated health request returns 404.
- TypeScript, ESLint through Next's production build, and `git diff --check` are part of the final checks.

## Implemented

Additive Neon/Drizzle schema and migration, editable profiles, explicit inbound apply/restore, signed connect/status/action/transfer handlers, Vercel and optional standalone ConversationRelay gateways, streamed/cancelable Groq/OpenAI runtime, validated tools and durable side-effect keys, optional Google Calendar, consented Twilio SMS and transfer adapters, SSE transcripts, history/outcomes, rate-card costs and budgets, context/caching measurements, optional deterministic routing, experiments, retention, tests and runbooks.

## Required for live acceptance

Verify credentials for each enabled agent's provider, account-visible chat/tool models, Twilio ConversationRelay onboarding, deployed WSS/HTTPS, schema, effective rates, budgets and profile. Authorize and allowlist a new consenting test recipient before any further call; optionally connect calendar and approved messaging/transfer destinations. The deployed socket probe is not an acoustic phone acceptance test.

The local setup now has the existing Twilio/Neon configuration, a separately stored Groq API credential, a generated gateway secret and a public ngrok HTTPS/WSS endpoint. Twilio's existing AI/ML-enabled setting was verified in the account console. Provider credentials are never printed or committed. OpenAI remains an optional alternative.

## Live setup result

The owner explicitly authorized one call to their own allowlisted test number. Twilio reported a completed 70-second call. ConversationRelay persisted ten transcript messages, six caller turns and three interruptions. Groq streamed responses using an account-visible `openai/gpt-oss-20b` model. All baseline cost components were priced; the total estimate was USD 0.281086550. The finalized voice charge was still pending at verification time, so the estimate is not represented as an invoice.

The call outcome remained Unresolved: it did not establish a qualified sales lead or appointment. Two tool writes succeeded but contained no new lead fields; they are not evidence of useful qualification. Review of that real-call evidence led to server rejection of empty lead updates, improved cancellation labels, a disclosure retry after immediate interruption, and correct classification of a normal caller hangup. Those fixes have automated regression tests. No second phone call was placed to validate them acoustically because authorization was limited to one call.

New outbound calls were paused after the test. That local demo used the Mac and ngrok; the subsequent Vercel production deployment below removes that runtime dependency. Calendar access and a further consented acoustic acceptance test remain separate. Personal test-contact and Call SID records are stored only in Neon and ignored local runtime files, not this document.

## Deferred / limits

One admin and one concurrent real demo call; English US configuration; atomic socket ownership across instances but no seamless reconnect or booking lock across third-party calendar clients. Vercel mode caps conversations at 240 seconds. Email, bulk outreach, AMD activation, recording, Media Streams, automatic retention scheduling, background reconciliation, full invoice imports/carrier fee reconciliation, number-rental allocation and automatic FX feeds are not implemented. Premium/economy voice labels do not imply lower prices when speech is bundled. Real speech accuracy, audible latency, blinded quality and operating-cost savings remain unmeasured.

The current fixed synthetic context fixture measured 29,928 baseline characters versus 10,591 optimized characters. This is a serialized-context measurement, not token billing or observed provider savings. See the generated report for the exact fixture description.

## Vercel production verification

The AI-only PR excludes concurrent Monitoring work. GitHub CI passed all checks, including the standalone container build and a production dependency audit with zero vulnerabilities. Node 22 typecheck/build and synthetic authenticated endpoint smoke checks passed. After unpromoted verification, the build was promoted to the public production domain. Login, AI dashboard/database reads, existing manual call history and browser-dialer token generation returned HTTP 200. Provider readiness returned liveReady, gateway ready and models available with no missing variables. A correctly signed WebSocket request upgraded with HTTP 101 and rejected an invalid session ticket with close code 1008. These probes created no call, transcript, message or LLM request. Outbound pause was explicitly saved and rechecked; inbound mode remains normal. Protected deployment testing used Vercel's authenticated CLI. See `production-release.md` for configuration and remaining voice acceptance limits.
