# Email-as-Prompt — wiring up the inbound side

**Status:** scaffold. The GitHub Actions workflow (`.github/workflows/email-as-prompt.yml`) is in place, but the inbound-email integration that fires it is not yet wired up. This doc covers the two viable options and the steps to choose and connect one.

**Ticket:** KAN-165 Phase 2.

## What the scaffold already does

`email-as-prompt.yml` listens on two triggers:

1. `repository_dispatch` with `event_type: "email-prompt"` — the production path. An external service POSTs a payload like:
   ```json
   {
     "event_type": "email-prompt",
     "client_payload": {
       "subject": "Re: weekly report",
       "body": "<the email body>",
       "ticket_key": "KAN-165"
     }
   }
   ```
2. `workflow_dispatch` — a manual button in the GitHub Actions UI for testing the Jira-posting path end-to-end without needing the inbound side wired up. Use this to validate that the Atlassian secrets and ADF formatting are correct.

When fired, the workflow posts the email subject + body as a comment on a designated Jira ticket (defaulting to `KAN-165` for the scaffold) using the Atlassian REST API.

It does NOT yet:
- Parse a real inbound email (the inbound service does that and sends only the body)
- Choose the ticket dynamically based on the email (it uses a hardcoded `KAN-165` or whatever the dispatch payload specifies)
- Authenticate the inbound dispatch against a known sender (any HMAC/signature check needs to be added — see [Security](#security))

## Option A — Resend inbound parsing

Resend doesn't currently expose inbound-email parsing as a first-class product, but they support webhook-style routing on a dedicated inbound subdomain. If/when they do:

1. Add an MX record on a subdomain like `inbound.checklyra.com` pointing at Resend's inbound endpoint.
2. Configure a Resend Webhook for incoming messages → POST to a small Cloudflare Worker (next section) that reformats the payload and dispatches the GitHub event.

This option ties the project to Resend's roadmap. Right now (May 2026), it's not viable as a standalone path.

## Option B — Cloudflare Email Worker (recommended)

Cloudflare's Email Workers feature is mature and is the path we should take:

1. **Set up Email Routing** on the `checklyra.com` zone (Cloudflare → Email → Email Routing). Enable Email Workers.
2. **Create a Worker** named `lyra-inbound-prompt` from the dashboard. Sample code:

   ```javascript
   export default {
     async email(message, env, ctx) {
       // Read the email body.
       const raw = await new Response(message.raw).text();
       const body = extractPlainText(raw); // strip MIME headers; you can use postal-mime
       const subject = message.headers.get('subject') ?? '(no subject)';
       const from = message.headers.get('from') ?? '(unknown)';

       // Allow-list check: only fire if the email is from an approved sender.
       if (!isAllowedSender(from)) {
         console.log('Rejected sender:', from);
         return;
       }

       // Dispatch the GitHub event.
       const r = await fetch(
         'https://api.github.com/repos/luisa-sys/lyra/dispatches',
         {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${env.GITHUB_DISPATCH_PAT}`,
             'Accept': 'application/vnd.github+json',
             'Content-Type': 'application/json',
             'User-Agent': 'lyra-inbound-prompt',
           },
           body: JSON.stringify({
             event_type: 'email-prompt',
             client_payload: {
               subject,
               body,
               ticket_key: extractTicketFromSubject(subject) ?? 'KAN-165',
             },
           }),
         }
       );

       if (!r.ok) {
         console.error('GitHub dispatch failed:', r.status, await r.text());
         throw new Error(`Dispatch failed: ${r.status}`);
       }
     },
   };
   ```

3. **Bind the Worker as the destination** for one of the inbound addresses (e.g. `prompt@checklyra.com`) under Email → Email Routing → Routing rules.
4. **Provide the Worker with a GitHub PAT**:
   - Generate a fine-grained PAT (`LYRA_DISPATCH_PAT`) scoped to `luisa-sys/lyra` with `Actions: write` permission only.
   - Set it as a Worker secret: `wrangler secret put GITHUB_DISPATCH_PAT`.
   - Add it to `docs/SECURITY_ROTATION.md` with a 12-month rotation cadence.

### Why Email Workers vs. an external SaaS

- No third-party data dependency — the email never leaves Cloudflare's edge before being parsed.
- Free tier covers Lyra's expected volume (a handful of emails a week).
- Sender allow-listing happens before the GitHub dispatch fires, so a malicious inbound email can't trigger anything.

## Security

The inbound flow accepts an email and turns it into a Jira comment. Without controls, that's an SSRF-ish gadget — a stranger could spam Jira tickets by emailing the inbox. Mitigations:

1. **Sender allow-list in the Worker.** Only `luisa@santos-stephens.com` (and any approved teammates) is allowed to trigger a dispatch. Hard-coded in the Worker; rejected senders are logged but no dispatch fires.
2. **SPF + DKIM verification.** Cloudflare Email Workers receive the verification results — refuse any message that doesn't pass DMARC against an approved sender domain.
3. **GitHub PAT scoping.** The PAT used by the Worker only has `Actions: write` on the lyra repo — nothing else.
4. **Workflow rate-limit.** The workflow itself doesn't rate-limit, but Cloudflare Email Workers can be wrapped in a Durable Object that throttles dispatches to N/hour.
5. **Atlassian token.** The workflow currently re-uses `ATLASSIAN_API_TOKEN_READONLY` which is read-only — posting comments via that token will 403. Before going live, provision a write-scoped Atlassian token (`ATLASSIAN_API_TOKEN_COMMENT`) restricted to comment creation, store as a separate secret, and update the workflow.

## Follow-up tickets

These are tracked separately and need to be filed when this scaffold lands:

- **KAN-XXX** Provision an Atlassian write-scoped token (`ATLASSIAN_API_TOKEN_COMMENT`) and switch `email-as-prompt.yml` to use it.
- **KAN-XXX** Build the Cloudflare Email Worker (`lyra-inbound-prompt`) and wire up the inbound route on a `prompt@checklyra.com` address.
- **KAN-XXX** Add ticket-key extraction from the subject line (e.g. `Re: KAN-150 ... → ticket_key=KAN-150`).
- **KAN-XXX** Add HMAC verification on the dispatch payload so the workflow refuses any dispatch that didn't come from the trusted Worker.
- **KAN-XXX** Add `docs/RUNBOOK.md` entry under "Weekly status review" describing how Luisa replies to the Monday report and Claude picks up the comment.

## Testing the scaffold today

Without the inbound side wired up, you can still verify the Jira-posting path:

1. Go to Actions → "Email as Prompt (scaffold)" → Run workflow.
2. Fill in `subject` and `body` with a test value, leave `ticket_key` as `KAN-165`.
3. Run.
4. Check KAN-165 in Jira — there should be a new comment with the test content.

If the comment doesn't appear, check the workflow run logs for the `::error::` annotation — the failure mode is always loud (no silent skips).
