# Sub-processor Register & International Transfers

> **Status: DRAFT for founder / legal review.** Prepared 2026-06-28 (SEC-2 / KAN-283).
> Not legal advice. The founder must (a) accept/reference each vendor's DPA,
> (b) confirm the transfer mechanism is current, and (c) sign off the TRAs.
> Review at least annually and whenever a vendor or a vendor's own
> sub-processor list changes.

**Controller:** CheckLyra Ltd (Lyra). **Last reviewed:** 2026-06-28.

## How to read this
- **Role:** processor = handles personal data on Lyra's instructions (Art. 28 DPA required). "Recipient (not processor)" = receives a click/onward action but not Lyra's user records.
- **Transfer mechanism:** the safeguard for UK→non-UK transfers (UK IDTA, or the UK Addendum to the EU SCCs, incorporated by the vendor's DPA). Where data stays in the UK/EEA on an adequacy basis, noted as such.
- **DPA status:** ☐ to accept/reference · ☑ accepted (record the date + link).

## Register

| Vendor | Purpose / data | Role | Region | Transfer mechanism | DPA status |
|---|---|---|---|---|---|
| **Supabase** | Postgres DB, Auth, Storage (profiles, contacts, media, OAuth tokens) | Processor | US (AWS; region TBC — prefer eu-west) | UK Addendum to EU SCCs via Supabase DPA | ☐ confirm + record |
| **Vercel** | App hosting / serverless rendering | Processor | US/global edge | UK Addendum via Vercel DPA (vercel.com/legal/dpa) | ☐ confirm + record |
| **Railway** | MCP server hosting (user-MCP + admin-MCP) | Processor | US | UK Addendum/IDTA via Railway DPA | ☐ confirm + record |
| **Cloudflare** | DNS, CDN, Access (admin gate), KV (waitlist emails), R2 (backups) | Processor | US/global | UK Addendum via Cloudflare Customer DPA | ☐ confirm + record |
| **Resend** | Transactional email (magic links, invites, notices) | Processor | US | UK Addendum/IDTA via Resend DPA | ☐ confirm + record |
| **Didit** | Age-assurance / biometric selfie check (returns pass + band only) | Processor (Art. 9 at provider) | TBC | Confirm DPA + Art. 9 explicit-consent basis + biometric retention | ☐ **confirm — special category** |
| **Google (OAuth/Calendar)** | Google sign-in; Calendar busy/free (Convene) | Processor | US | UK Addendum via Google Cloud/Workspace DPA | ☐ confirm + record |
| **Cloudflare R2** | Encrypted WORM backups (age-encrypted) | Processor | US/global | As Cloudflare above | ☐ confirm + record |
| **Affiliate merchants** (Amazon Associates, Bookshop.org, …) | Receive outbound affiliate clicks (no Lyra PII in URLs) | Recipient (not processor) | US/UK | N/A — no personal data transferred by Lyra | n/a |
| **GitHub** | Source code, CI | Not a processor of user data | US | (internal tooling) | n/a |
| **Atlassian** (Jira/Confluence) | Internal issue/risk tracking | Not a processor of user data | US/EU | (internal tooling) | n/a |
| **Railway/Cloudflare/Vercel logs** | Operational logs (may include IP) | Processor | as above | as above | covered by each DPA |

> **Action (founder):** for each row marked ☐, accept the vendor's standard DPA
> online and record the acceptance date + link in this table. All of the major
> infra vendors (Supabase, Vercel, Cloudflare, Resend, Google) incorporate the
> UK Addendum/IDTA by reference, so no bespoke negotiation is needed.

## Transfer Risk Assessments (TRA) — one paragraph per vendor

For each US-based processor the transfer relies on the UK Addendum to the EU
SCCs (or the UK IDTA) as the Art. 46 safeguard. Lyra's data is low-sensitivity
consumer profile data (no financial, health, or government-ID data is stored by
Lyra; the only biometric step is performed by Didit, which returns a result, not
the image). The residual risk from US government access (FISA 702 / EO 12333) is
low for this dataset: it is not of foreign-intelligence interest, volumes are
small, and the major vendors publish transparency reports and challenge
over-broad requests. Mitigations: encryption in transit and at rest, encryption
of backups with a key held outside the storage provider (age + R2 WORM),
least-privilege access, and the right to suspend a processor on a material
change. **Conclusion (draft): transfers are permissible under the UK
Addendum/IDTA with the above supplementary measures.** Founder to confirm
per-vendor and re-assess on any change to the vendor's posture.

**Didit is the exception requiring extra diligence** — biometric processing is
Art. 9 special-category. Confirm (1) Didit's Art. 9 lawful basis (explicit
consent, captured by Didit at the point of the selfie), (2) Didit's retention
and deletion of the biometric image, (3) the transfer mechanism for Didit's
region, and (4) that Lyra never receives or stores the raw biometric. Record the
outcome here before relying on the age-assurance flow at scale.

## Onward sub-processors
Each processor maintains its own sub-processor list (e.g. Supabase→AWS,
Vercel→AWS/Cloudflare, Resend→AWS). UK GDPR requires the controller be informed
of changes and able to object. **Action (founder):** subscribe to each vendor's
sub-processor-change notifications and record the subscription here.
