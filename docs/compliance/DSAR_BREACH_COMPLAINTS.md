# Data-Subject Rights, Breach & Complaints Procedures

> **Status: DRAFT for founder / legal review.** Prepared 2026-06-28 (SEC-2 / KAN-283).
> Not legal advice. These procedures must be adopted by the controller, the
> intake inboxes must be live and monitored, and the public-facing routes
> (privacy notice / support pages) must link them before launch.

**Controller:** CheckLyra Ltd (Lyra). **Intake:** privacy@checklyra.com.
**Last reviewed:** 2026-06-28.

---

## 1. Data-Subject Access & Rights (DSAR) — UK GDPR Art. 12–22

**Rights handled:** access (Art. 15), rectification (16), erasure (17),
restriction (18), portability (20), objection (21).

**Intake:** privacy@checklyra.com (also accept in-app requests). Log every
request in the DSR log (date received, identity-verification status, type,
due date, outcome date).

**Clock:** respond **within one calendar month** of receipt, free of charge.
May extend by up to two further months for complex/numerous requests — tell the
requester within the first month, with reasons.

**Steps:**
1. **Acknowledge** on receipt; start the one-month clock.
2. **Verify identity** proportionately (confirm control of the account email).
   Don't over-collect ID. If genuinely unverifiable, explain and pause the clock.
3. **Locate** the data: Supabase (profile, contacts, gatherings, tokens, age
   result), Cloudflare KV (waitlist), Resend (email logs), Didit (age/biometric
   — request via the provider). Use the ROPA as the checklist.
4. **Action** the right: access → export the user's data in a portable format
   (JSON/CSV); erasure → run the deletion/anonymisation per RETENTION_SCHEDULE.md
   (note the time-limited backup exception); rectification → correct + confirm.
5. **Respond** with the data/outcome and signpost the complaints route + ICO.
6. **Close** the log entry with the outcome date.

**Refusals** (manifestly unfounded/excessive, or an exemption applies) must be
explained, with the right to complain to the ICO.

---

## 2. Personal-Data Breach — UK GDPR Art. 33/34

**Definition:** any breach of security leading to accidental or unlawful
destruction, loss, alteration, unauthorised disclosure of, or access to,
personal data.

**Golden rule: the 72-hour clock starts when you become *aware* a breach has
*likely* occurred — not when the investigation finishes.**

**Steps:**
1. **Contain** — stop the leak (revoke keys/tokens, take a surface offline,
   rotate credentials). Cross-reference the Incident Response runbook (OPS-02).
2. **Log immediately** in the **breach register** (template below) — *every*
   breach, notifiable or not. This record is itself an Art. 33(5) requirement.
3. **Assess risk** to individuals (likelihood + severity of harm).
4. **Notify the ICO within 72 hours** *if* the breach is likely to result in a
   risk to people's rights and freedoms — via the ICO personal-data-breach
   report form. If reporting after 72h, include the reasons for delay.
5. **Notify affected individuals without undue delay** *if* the breach is likely
   to result in a **high** risk to them (Art. 34), in plain language, with the
   likely consequences and the steps you're taking.
6. **Review** — root cause, remediation, lessons; update controls.

**Breach register template (one row per incident):**

| ID | Detected (date/time) | Description | Data + people affected | Risk assessment | ICO notified? (date / why not) | Individuals notified? | Remediation | Closed |
|----|----|----|----|----|----|----|----|----|

ICO breach-report form:
https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/

---

## 3. Data-Protection Complaints — DUAA statutory duty (in force 19 June 2026)

Under the Data (Use and Access) Act 2025, every controller must operate an
accessible complaints process. This applies to Lyra from day one of launch.

**Channel:** a clearly-signposted route on the site/support pages and via
privacy@checklyra.com (and/or a web form). Must be easy to find and use.

**Steps & timings:**
1. **Acknowledge** a data-protection complaint **within 30 days** of receipt.
2. **Investigate** without undue delay; keep the complainant informed of progress.
3. **Communicate the outcome** in writing.
4. **Signpost the ICO** (name + contact details) as the complainant's escalation
   route if they remain dissatisfied.
5. **Log** every complaint in the complaints log (below).

**Complaints log template:**

| ID | Received | Complainant | Summary | Acknowledged (≤30d) | Investigation notes | Outcome + date | ICO signposted? |
|----|----|----|----|----|----|----|----|

Align wording with the ICO's final guidance "How to deal with data protection
complaints" (published 12 Feb 2026).

---

## Where these must appear publicly (before launch)
- **Privacy notice:** name the controller, ICO registration reference, lawful
  bases, retention, the DSAR route, the **complaints route**, and the
  international-transfer safeguard. Cross-check against the ROPA.
- **Support / contact pages:** link the complaints channel and privacy@ inbox.
