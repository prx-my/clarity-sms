# Repository audit and implementation plan

Audit date: 2026-10-25. This is an extension of Clarity SMS, not a replacement.

## Existing application

- Next.js 15.5 App Router, React 19, TypeScript, Tailwind 4, existing Radix primitives and CSS tokens.
- Next route handlers implement authenticated single-admin JSON APIs. JWT cookies are checked by middleware and API handlers.
- `src/components/voice-dialer.tsx` uses the Twilio browser SDK and `/api/voice/token`. The signed `/api/voice/outbound` webhook returns `<Dial><Number>`; `/api/voice/calls` reads history from Twilio.
- `/api/twilio/inbound` and `/api/twilio/status` are **SMS** webhooks. There is no inbound voice handler. These SMS URLs must not be repurposed.
- Drizzle with Neon HTTP Postgres; contacts, conversations, messages, delivery events and webhook logs already exist. Contacts are the existing lead identities. Opt-out is stored on contacts.
- Configuration uses environment variables and `.env.local`. Real secrets were inspected for presence only, never copied or printed.
- No existing AI integration, speech transport, usage ledger, WebSocket infrastructure or tests. CI runs typecheck and production build. Deployment includes Vercel metadata.

## Plan

1. Preserve manual dialer routes and add AI mode to Calls with the existing UI primitives.
2. Extend Drizzle with agent profiles, consent/lead memory, sessions, transcripts, tool audits, usage, qualifications, events, rate cards and workspace configuration.
3. Add signed AI voice webhooks below `/api/twilio/ai/`. Use Twilio's SDK for ConversationRelay TwiML and call control.
4. Run a separate long-lived Node WebSocket gateway. Existing Next/Vercel hosting does not provide a persistent WebSocket listener. Both processes share Neon; the dashboard uses authenticated SSE snapshots. No Redis required for this single-concurrent-demo-call MVP.
5. Stream OpenAI chat completions with bounded tool rounds, usage capture, cancellation and deterministic opt-out/transfer handling. Isolate the transport behind an interface.
6. Validate tools with Zod, bind all lookups/actions to the session contact, claim durable idempotency keys before side effects, require transcript confirmation, and return unavailable when integrations are missing.
7. Add versioned pricing, decimal-safe estimates, unknown-charge visibility, budgets, context management, deterministic optional model routing and measured experiment cohorts.
8. Add local in-memory simulations explicitly separated from real calls, regression tests, migration generation, setup/deployment docs and a demo script.

## External verification

Official documentation checked: [ConversationRelay TwiML](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay), [WebSocket protocol](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages), [onboarding](https://www.twilio.com/docs/voice/conversationrelay/onboarding), [OpenAI streaming](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

The account must accept Twilio's AI/ML addendum and enable ConversationRelay. Public documentation does not establish account entitlement. No real call is represented as verified until a consented allowlisted call is actually tested. OpenAI account-specific model access is checked through the application's readiness endpoint once credentials exist.
