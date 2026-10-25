# Clarity SMS

A focused, single-user inbox for two-way SMS with Twilio. It includes conversations, contacts, delivery history, analytics, opt-out handling, and a local demo with sample messages.

## Stack

Next.js, React, TypeScript, Tailwind CSS, Drizzle ORM, Neon Postgres, and Twilio.

## Try the demo

Requires Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local
```

Set `DEMO_MODE=1` in `.env.local`, then run:

```bash
npm run dev
```

Open the URL printed by Next.js. The demo uses in-memory sample data and simulated delivery updates. It does not send SMS or need a database. Demo changes reset when the server restarts.

## Connect Twilio and Neon

1. Create a Neon Postgres database and a Twilio phone number with SMS enabled.
2. Copy `.env.example` to `.env.local` and set the variables below. Leave `DEMO_MODE` empty or remove it.
3. Apply the database schema with `npm run db:push`.
4. Start the app with `npm run dev` and sign in with `ADMIN_PASSWORD`.
5. Set the Twilio number's incoming-message webhook to `https://your-origin/api/twilio/inbound` using `POST`. The app supplies its status callback URL when sending SMS.

## Browser dialer

The Calls page places outbound voice calls using the browser microphone and your voice-capable Twilio number. It does not change where incoming phone calls are routed.

1. Create a TwiML App in Twilio with Voice Request URL `https://your-origin/api/voice/outbound` and method `POST`.
2. Create a Standard Twilio API key. Set `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, and `TWILIO_TWIML_APP_SID` in `.env.local` or your host's secret settings.
3. Open Calls, dial a phone number with its country code, and allow microphone access. Recent outgoing calls are read from Twilio.

For local webhooks, expose the dev server through an HTTPS tunnel and set `APP_URL` to that tunnel's origin. For deployment, set the same environment variables on the host and set `APP_URL` to the deployed HTTPS origin. Twilio request validation depends on that URL matching the public origin.

| Variable | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token used for sending and webhook validation |
| `TWILIO_PHONE_NUMBER` | SMS-capable number in E.164 format |
| `TWILIO_API_KEY_SID` | Standard API key SID for browser voice tokens |
| `TWILIO_API_KEY_SECRET` | Standard API key secret for browser voice tokens |
| `TWILIO_TWIML_APP_SID` | TwiML App with Voice Request URL pointing to `/api/voice/outbound` |
| `DATABASE_URL` | Neon Postgres connection string |
| `APP_URL` | Public origin used for webhook validation and callbacks |
| `ADMIN_PASSWORD` | Password for the single admin account |
| `SESSION_SECRET` | Random secret of at least 32 characters for signed sessions |
| `DEMO_MODE` | Set to `1` for the local sample-data demo |

Do not commit `.env.local` or production credentials. Twilio trial accounts can send only to verified destinations.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run typecheck` | Check TypeScript |
| `npm run build` | Build for production |
| `npm run db:generate` | Generate a SQL migration |
| `npm run db:push` | Apply the Drizzle schema to Postgres |

CI runs the TypeScript check and production build for pushes and pull requests.

## AI voice assistant

Calls now has **Manual Dialer | AI Agent** modes. The manual browser dialer and SMS routes are preserved; AI is disabled by default and has its own gateway, tables and signed webhooks.

The integrated implementation includes editable agents, ConversationRelay, streamed OpenAI or Groq responses, interruptions, validated tools, contact consent/opt-out handling, live transcripts, persistent outcomes, versioned cost estimates and budget controls. See the [setup and deployment guide](docs/ai-voice-setup.md), [demo script](docs/ai-demo-script.md), and [implementation audit](docs/ai-voice-implementation.md).

For local checks with **no provider spend or production database writes**:

```bash
npm ci
npm test
npm run simulate
npm run typecheck
npm run build
```

`npm test` includes an embedded Postgres migration/persistence test. `npm run simulate` writes `docs/voice-simulation-report.json`, explicitly labeled synthetic; it never creates a real call, message or calendar booking. For a preview UI, run with `DEMO_MODE=1`, `ADMIN_PASSWORD`, and a 32-character `SESSION_SECRET`; Calls → AI Agent uses ephemeral agent settings and disables live calls. Existing preview contacts are sample SMS data.

Live operation additionally requires a key for the selected OpenAI or Groq provider, enabled Twilio ConversationRelay account, HTTPS/WSS hosting and migrated Neon tables. Production can use the existing Vercel Fluid Compute project with `AI_GATEWAY_MODE=vercel` and a four-minute conversation limit. Local phone demos use the standalone gateway (`npm run voice:start` or `npm run voice:dev`). Deployment, cost limits and the environment matrix are in the [production release guide](docs/production-release.md).

An owner-authorized real call was completed during local setup using Twilio ConversationRelay and Groq; see the [verification report](docs/ai-verification.md) for measured results and remaining limits. Automated tests and simulations never place provider calls, change routing or deploy database changes.
