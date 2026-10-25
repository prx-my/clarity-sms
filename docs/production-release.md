# AI voice production release

## Current release decision

The AI voice change is deployed on the existing Vercel project's Fluid Compute WebSocket runtime, with no separate Railway service. Existing SMS and browser dialing retain their current routes and credentials. On 2026-10-25, the unpromoted deployment passed verification and was promoted to the production domain. The public production domain then passed authenticated dashboard/database reads, browser-dialer token generation, Groq model availability, secret-protected gateway health, and a signed HTTP 101 WebSocket upgrade; an invalid session ticket was rejected with close code 1008. Outbound remains paused, the production outbound allowlist is empty, and inbound routing remains normal. No additional phone call, SMS or calendar action was placed. Local ngrok/loopback settings are rejected in production. The owner explicitly authorized the existing demo Groq key for this Vercel project; rotate it before general production use.

This PR intentionally excludes the concurrent Monitoring implementation and migration `0002`. The AI migration is `0001_yellow_bromley.sql`; it adds ten tables and preserves existing contacts, conversations and messages. The configured database's AI schema was verified through the deployed dashboard; no new production migration was needed in this release. Fresh/journal-managed databases use `npm run db:migrate`. A legacy database installed using `db:push` needs an inspected baseline or the additive migration applied transactionally once; do not replay `0000` over existing SMS tables. Tests exercise the SQL with existing SMS data. No production migration is executed by CI or the web build.

## Environment matrix

Production variable names were inspected on the linked Vercel project without downloading its secret values. AI settings and encrypted secrets were subsequently configured with the owner's authorization and verified through authenticated deployed endpoints. The existing admin login, database reads and manual call history returned HTTP 200. No production secret is included in this report.

| Variable | Vercel metadata | Required location and value |
| --- | --- | --- |
| `DATABASE_URL` | Present | App and gateway; same migrated Neon database |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Present | App and gateway; existing Twilio account and number |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID` | Present | App; existing browser dialer credentials |
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Present | App; session secret at least 32 characters |
| `APP_URL` | Present | App and gateway; canonical production HTTPS origin; no tunnel or path |
| `DEMO_MODE` | Present | App and gateway; unset or `0` for live production |
| `AI_VOICE_ENABLED` | Configured | `1` only after deployment verification; workspace outbound pause still applies |
| `AI_DEPLOYMENT_MODE` | Configured | `production`; Vercel also uses its system `VERCEL_ENV` guard |
| `AI_GATEWAY_MODE` | Configured | `vercel`; `standalone` remains available for optional Node hosting |
| `AI_LLM_PROVIDER`, `AI_LLM_MODEL` | Configured | `groq`, `openai/gpt-oss-20b`; account model visibility verified |
| `GROQ_API_KEY` | Encrypted sensitive variable | Owner-authorized provider secret; no OpenAI key required for Groq agents |
| `AI_WEBSOCKET_PUBLIC_URL` | Configured | `wss://<APP_URL host>/api/twilio/ai/relay` |
| `AI_GATEWAY_SECRET` | Encrypted sensitive variable | Generated random 64-character secret |
| `AI_CONVERSATION_RELAY_ACKNOWLEDGED` | Configured | `1`; account onboarding was previously verified in Twilio Console |
| `AI_DEMO_ALLOWED_NUMBERS` | Intentionally unset | Empty denies outbound; new destination/consent authorization is required |
| `AI_GATEWAY_PORT` | Gateway only | `3001` in the container; map the host's ingress port |
| `AI_PROXY_APP_URL` | Local demo only | Unset in production; production validation rejects it |
| `GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Optional | App and gateway only when enabling real calendar tools |

No secret needs a `NEXT_PUBLIC_` prefix. Vercel Preview needs separate credentials/database if testing live features there; CI uses synthetic data and no production secrets. An agent can select a different provider from the environment default; configure that provider's credential on both services too.

## Vercel deployment

Use `AI_GATEWAY_MODE=vercel` and the existing production application hostname for both `APP_URL` and the WSS endpoint. This project was verified to have Fluid Compute enabled. The Next route uses the installed `@vercel/functions` `upgradeWebSocket` API and `ws`; it validates Twilio's handshake signature before upgrading, then validates the session/call-bound ticket and atomically claims one socket owner in Postgres. It keeps the invocation open through socket cleanup. Reconnects do not start a second agent for the same call.

The function's maximum duration is 300 seconds. Session snapshots cap AI conversations at 240 seconds, and a 270-second socket watchdog leaves room for cleanup. Longer profile limits remain available for standalone hosting. Signed Twilio action/status callbacks provide failure fallback; seamless reconnect is not implemented. The original profile is not silently edited. Use the standalone gateway if longer uninterrupted calls are required.

The secret-protected health path is `/api/twilio/ai/health`. An actual signed deployment handshake must be tested as well as health: configuration and model availability alone cannot establish that the platform's upgrade runtime works. Preview deployment protection must allow Twilio's handshake if using live providers in a preview. No automated test places a real call.

Vercel [WebSocket support](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections) bills function memory for the connection lifetime, active CPU, invocations and transfer. Reusing the project avoids a separate always-on service, but does not make voice, model or hosting usage free. Keep outbound paused, maintain strict budgets and allowlists, and monitor actual provider bills. No Railway project, service or subscription is created.

## Optional standalone gateway

Build with `docker build -f Dockerfile.gateway -t clarity-voice-gateway .` and run one replica with the gateway variables injected by the host's secret manager. The image copies no `.env` files, runs as a non-root user, and installs production dependencies only. Route TLS ingress to port 3001, preserve WebSocket upgrade headers and Twilio's signature header, and use an idle timeout longer than the agent's maximum call duration. `/relay` is authenticated with the Twilio handshake signature and a short-lived session/call ticket. `/health` requires `x-ai-health: <AI_GATEWAY_SECRET>` and returns no caller data or credentials. Do not place the gateway behind an interactive login page.

Use `AI_GATEWAY_MODE=standalone` for this container. It runs the same socket lifecycle as the Vercel route. Its WSS endpoint and health path are `/relay` and `/health`.

The MVP supports one admin and one concurrent real AI call. The database prevents two concurrent real call reservations and atomically claims one socket owner per session across instances. Automatic lease recovery and seamless reconnect are not implemented. A gateway restart interrupts an active call; signed Twilio callbacks and operator reconciliation close its persisted state. Schedule deployments while outbound is paused and no session is active. No gateway was provisioned on Railway.

## Validation and activation

`npm run check:env` validates the deployment process's variables and prints only names and requirements. An explicitly selected local file can be checked with `ENV_FILE=/secure/path/production.env npm run check:env`; do not download production secrets just to run this check. The check is independent of the build, which must succeed without production secrets. It does not authenticate providers, inspect database migrations, or test network reachability.

Before activation, confirm the AI schema exists in the production database, set provider and gateway variables on both services, and run authenticated **Calls → AI Agent → Settings → Verify providers**. Configuration alone is never reported as live readiness. The check must reach the secret-protected gateway and list the enabled agents' models from their actual providers. Verify effective destination/model rate cards, budgets, consent and the intended profile. Retain the existing Twilio number routing until explicitly applying AI inbound routing. Outbound remains paused after the authorized local demo.

Production rejects temporary tunnel hosts, local proxy configuration, non-TLS/credential-bearing URLs, and demo mode. Groq keys only go to Groq's fixed API origin; OpenAI keys only go to OpenAI. This release upgrades Drizzle ORM and overrides PostCSS with patched versions; production dependency audit is part of CI. Real voice acceptance, optional calendar setup, finalized billing and operational monitoring remain separate requirements. The one authorized live demo is documented in `ai-verification.md`; it is not a full production acceptance run.

Rollback: set `AI_VOICE_ENABLED=0`, pause new outbound calls, let active calls finish, and use **Restore original routing** if AI routing was applied. Preserve AI billing/session tables when rolling back application code. No cleanup command drops existing SMS or AI data.
