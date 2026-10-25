# Client demo runbook

## Preflight

1. Run tests, simulation, typecheck and production build. Apply additive schema changes to the intended database.
2. Configure the application and gateway with the same provider credentials and gateway secret. Use actual HTTPS/WSS public endpoints.
3. Complete Twilio ConversationRelay onboarding. In the app, enable the reviewed Schrader profile and click Verify providers.
4. Add reviewed rate cards for the selected models, Relay, destination voice/transfer rates and enabled messaging. Set a small workspace budget. Review any missing-rate warning.
5. Add only consenting test recipients to `AI_DEMO_ALLOWED_NUMBERS`. Create/select their existing contacts. Record the consent's source, time, purpose and correct caller timezone. Ensure it is within agency-configured calling hours. Do not bypass a real opt-out for another demonstration; use a different consenting test contact for the next scenario.
6. Configure a dedicated real Google calendar if demonstrating booking, an approved HTTPS demo page if demonstrating SMS, and a reachable agency transfer number. Enable SMS tools only for the recipient who agreed to receive it. Otherwise demonstrate the honest unavailable fallback.

## A — Inbound website inquiry

Save allowlist inbound mode and agent; explicitly apply it to the connected Twilio number. Call from the allowlisted test telephone.

- AI/company disclosure must be heard.
- Caller: “I have a roofing business, and my website is really outdated.”
- Caller: “I'd like more quote requests.”
- Agent asks only unknown qualification details and offers a team consultation.
- Agent queries the real calendar. If no calendar is configured, it must say it cannot check availability.
- For a real available slot, the agent reads the complete date/time/timezone label and asks to book it. Caller explicitly confirms.
- Verify an actual Google Calendar event exists and its ID appears in the successful tool audit. Do not call a simulation or failed result a booking.
- End the call. Verify transcript, outcome, lead evidence, duration and cost breakdown remain after a page reload. Reconcile the Twilio Call price.

## B — Send the approved demo page

Use a lead with a legitimate approved demo URL. Agent asks permission to text the link; caller says “Please text me the demo link.”

Confirm one Twilio message SID and one Inbox record. The agent may report queued/accepted for delivery when the provider accepts it; it must not claim delivered without confirmation. Test a provider failure through the local injected-provider test, then verify no fabricated success appears.

## C — Interrupt pricing explanation

During an explanation, say “Actually, I only want the pricing.”

The agent stops its previous response and answers the current question. If prices aren't configured, it explains that accurate pricing requires speaking with the team. The interrupted transcript should show the prefix reported by Twilio, not every generated word. Review actual first-response and turn latency events; assess audible turn-taking on the telephone.

## D — Opt out

Caller: “I'm not interested. Don't call again.”

The system immediately suppresses the existing contact, records Opted out and concludes politely without another sales pitch. Try a new outbound AI call to that same contact: the server must reject it. A stale fact update or newly saved consent must not clear suppression.

## E — Human transfer

Caller: “Can I speak to a real person?” or presses zero.

The call is redirected to the configured number. Verify transfer initiated and the actual Dial outcome separately. No-answer/busy must produce an honest fallback. If no transfer destination is configured, the assistant offers to record a callback request instead of asserting a successful handoff.

## Restore

Click Restore original routing, verify the purchased number's prior voice configuration in Twilio, and confirm the manual browser dialer and SMS inbox still operate. Pause new outbound AI calls after the demo.

## Evidence to capture

- Real Call SID and connected timestamps; no invented successful call.
- Consented test recipient and consent record, with public client material redacted.
- Actual interruption event, heard-prefix transcript and canceled request usage flag if final usage is unknown.
- Tool inputs/evidence, provider IDs, succeeded/failed/unknown statuses.
- Calendar event if configured, SMS delivery state if used, lead qualification outcome.
- Per-call versioned cost breakdown, missing charges, finalized Twilio voice amount, sourced/timestamped INR rate if used.
- Baseline versus optimized measurements only after enough comparable real audio calls; record business quality and tool accuracy alongside cost and latency.
