# Test Runbook — Sign-up, Access, Age Verification & Publish

> **Purpose.** A repeatable, prove-every-permutation manual test pass for the
> sign-up → waitlist/beta → age-verification → publish → public-profile flow,
> across **dev / beta / prod**. Run it **before and after any release that
> touches**: auth/sign-up, the access model (`user_status`/`access_tier`,
> KAN-326), the waitlist gate, age verification (Didit, KAN-282), publish, the
> invite code (KAN-336), or the homepage framing/examples (KAN-273/334).
>
> Keep it green. A failing case here means a real regression in the gate that
> protects who gets into the product and who can publish.

**Owner:** Luisa / Ben · **Last updated:** 2026-06-29 · **Tracks:** KAN-326, KAN-336, KAN-337, KAN-334, KAN-282, KAN-273, SEC-37.

---

## 0. Environment & config matrix (the intended end-state)

Four **independent** axes per environment — verify each matches this table first
(a drift here is usually the root cause of a "weird" result):

| Axis | dev (`dev.checklyra.com`) | beta (`beta.checklyra.com`) | prod (`checklyra.com`) |
|---|---|---|---|
| **Supabase project** | dev-lyra `ilprytcrnqyrsbsrfujj` | prod-lyra `llzkgprqewuwkiwclowi` | prod-lyra `llzkgprqewuwkiwclowi` |
| **`isProdDeploy()`** | false | false | **true** |
| **`isProdFamily()`** (gate) | false (`IS_BETA_DEPLOY` unset) | **true** (`IS_BETA_DEPLOY=true`) | **true** |
| **Waitlist gate enforced?** | No — gate inert (lands on dashboard) | **Yes** → non-`live` user → `/waitlist` | **Yes** → non-`live` → `/waitlist` |
| **Homepage** | waitlist landing (`LYRA_FORCE_WAITLIST=true`) | product showcase + "A few people to meet" band | waitlist landing (no band) |
| **Sign-up framing** | "Join the waitlist" (`LYRA_FORCE_WAITLIST`) | "Join the waitlist" (`isProdFamily`, post-#397) | "Join the waitlist" |
| **Invite-code field** | hidden (`LYRA_INVITE_CODE` unset) | **shown** (`LYRA_INVITE_CODE` set on beta scope, 2026-06-28) | shown (`LYRA_INVITE_CODE` set) |
| **Beta-invite deep-link** (KAN-337) | off (no code) | `…/join?code=` works + dashboard "Share beta access" card | same — share link uses `checklyra.com` host |
| **Homepage examples seeded** | 6 (`@seed`) — not shown (waitlist landing) | 6 (`@seed`) — **shown** in band | 6 (`@seed`) — not shown (waitlist landing) |
| **`AGE_VERIFICATION_REQUIRED`** | per env (confirm) | `true` | `true` |
| **MCP** | `mcp-dev.checklyra.com` (dev key) | `mcp.checklyra.com` (prod key) | `mcp.checklyra.com` (prod key) |

**Pre-flight checks** (quick `curl` / DB, do these before the cases):
```bash
for e in dev.checklyra.com beta.checklyra.com checklyra.com; do
  echo "== $e =="
  S=$(curl -s "https://$e/signup")
  echo "  code field:  $(echo "$S" | grep -oiE 'invite_code|Skip the waitlist' | head -1)"
  echo "  framing:     $(echo "$S" | grep -oiE 'Join the Lyra waitlist|Create account' | sort -u | tr '\n' '/')"
  echo "  homepage:    $(curl -s "https://$e/" | grep -oiE 'A few people to meet|opening Lyra a few people' | sort -u | tr '\n' '/')"
done
```

---

## 1. Test accounts & how to read the magic links

Sign-up is passwordless (magic link / OTP). To complete a case you must open the
confirmation email. Use addresses whose inbox you can read:

| Address | Inbox you read | How |
|---|---|---|
| `ben@benstephens.co.uk` | **ben@santos-stephens.com** | alias/catch-all → Gmail account `u/2` in Chrome |
| `ben+<tag>@santos-stephens.com` | **ben@santos-stephens.com** | Google `+` addressing → same inbox |
| `luisa+<tag>@santos-stephens.com` | **luisa@santos-stephens.com** | `+` addressing → Gmail MCP / `u/0` |

- Each magic link points at `https://checklyra.com/auth/confirm?token_hash=…&type=signup`. The token is **host-independent** — to confirm on a specific deploy, swap the host (e.g. `https://beta.checklyra.com/auth/confirm?token_hash=…`).
- Tokens are **single-use**; a stale token redirects to login.
- **Never reuse** `ben@santos-stephens.com` / `luisa@santos-stephens.com` for destructive sign-up tests — those are the real founder accounts.

**Reset (so an email can be re-tested):** an address can only be "new-signup"
tested once until its account is removed. See **§6 Reset** to clear test accounts.

---

## 2. Sign-up route cases

> Run each on the env(s) noted. **Verify** = the DB query under the case (run via
> Supabase MCP / SQL editor against that env's project).

### A1 — No-code email sign-up → waitlist
- **Env:** beta (primary), prod. **Pre:** address has no existing account.
- **Steps:** `/signup` → (no code) → name + email → agree → "Join the waitlist". Open the magic link → confirm on the **same host**.
- **Expect:** lands on **`/waitlist`** ("You're on the list… invite-only… we'll email you"). NOT the dashboard.
- **Verify:**
  ```sql
  select user_status, access_tier, is_published from profiles p
  join auth.users u on u.id=p.user_id where u.email ilike '<addr>';
  -- expect: waitlist | beta | false
  ```
- **Dev note:** on dev the gate is inert → a no-code signup lands on `/dashboard` (still `user_status='waitlist'` in DB). This is expected (dev is single-env, not prod-family).

### A2 — Correct invite code → skip waitlist → beta
- **Env:** prod (code is set there); beta **after** `LYRA_INVITE_CODE` is set on beta.
- **Steps:** `/signup` → enter the **correct** `LYRA_INVITE_CODE` value → name + email → submit → magic link → confirm.
- **Expect:** lands on the **dashboard** (beta app), NOT `/waitlist`.
- **Verify:**
  ```sql
  select u.raw_user_meta_data->>'invite_code' as carried, p.user_status, p.access_tier,
         p.beta_access_status, p.access_stage
  from auth.users u join profiles p on p.user_id=u.id where u.email ilike '<addr>';
  -- expect: <the code> | live | beta | approved | beta
  ```
  The carried code is re-validated **server-side** in `resolveBetaAccess`; possessing the value IS the authorisation.

### A3 — Wrong invite code → rejected
- **Env:** any env where the field shows. **Steps:** enter a **wrong** code → submit.
- **Expect:** redirected back to `/signup?error=…` with an "invalid code" message; **no account created**.
- **Verify:** `select count(*) from auth.users where email ilike '<addr>'` → **0**.

### A4 — Google (OAuth) sign-up → waitlist
- **Env:** beta/prod. **Steps:** "Continue with Google" → pick a Google account with no Lyra account.
- **Expect:** account created, **no invite code carried** → `user_status='waitlist'` → `/waitlist`.
- **Verify:** as A1. (OAuth signups never carry a code — by design.)

---

## 3. Access-gate cases

### B1 — Waitlist user is gated out of the app
- **Pre:** a `user_status='waitlist'` account (from A1), signed in, on **beta/prod**.
- **Steps:** navigate to `/dashboard`.
- **Expect:** redirected to **`/waitlist`**. Cannot reach the editor, settings, or publish.

### B2 — Beta-live user reaches the app
- **Pre:** `user_status='live'`, `access_tier='beta'` (from A2), on **beta**.
- **Steps:** sign in → `/dashboard`.
- **Expect:** dashboard renders ("Welcome, …", profile card, Edit/Publish steps).

### B3 — Routing by tier
- **Expect:** `live`+`access_tier='prod'` → routed to `checklyra.com`; `live`+`beta` → `beta.checklyra.com`; non-`live` → `/waitlist`. (Set `access_tier` via the admin console to test.)

---

## 4. Age-verification cases (KAN-282 / Didit)

> `AGE_VERIFICATION_REQUIRED=true` on beta/prod. Age status lives in
> `profiles.age_status` (`none`/`pending`/`passed`/`failed`/`manual_review`).

### C1 — Cannot publish without age passed
- **Pre:** a `live`/`beta` user with `age_status='none'`, profile editor open.
- **Steps:** add some content → click **Publish**.
- **Expect:** publish is **blocked** — an **age banner** appears with a **"Verify age"** button; Status stays **Private**. (No silent failure — KAN-326 fixed the silent publish-error.)
- **Verify:** `select is_published, age_status from profiles … ` → `false | none`.

### C2 — Real Didit age check → passed
- **Steps:** click **Verify age** → complete the Didit selfie flow → wait for the webhook.
- **Expect:** `age_status` transitions `none → pending → passed` (or `failed`). Webhook updates the row.
- **Verify:** `select age_status, age_provider, age_checked_at from profiles …` → `passed | didit | <ts>`.
- **Test shortcut (non-Didit):** to test the *publish-after-pass* path without a real selfie, set age passed manually (owner-authorised):
  ```sql
  update profiles set age_status='passed', age_checked_at=now(), age_provider='manual',
         age_range='30_44' where user_id='<uuid>';
  -- age_range CHECK allows ONLY: 0_5,6_12,13_17,18_29,30_44,45_64,65_plus (NOT '18+')
  ```

### C3 — After age passed → publish succeeds
- **Pre:** C2 done (`age_status='passed'`). **Steps:** reload dashboard → editor → **Publish**.
- **Expect:** Status → **Public**, no age banner.

---

## 5. Publish & public-profile cases

### D1 — Publish → public profile renders
- **Pre:** `live` + age `passed` + some profile content.
- **Steps:** **Publish** → open the Profile URL.
- **Expect:** Status **Public**; the public profile renders (name, headline, location, gift-recommendation band).
- **Verify (genuinely public, no cookies):**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://<host>/<slug>   # expect 200
  curl -s https://<host>/<slug> | grep -oiE "<display name>|<headline>"  # present
  ```

### D2 — Unpublish → not public
- **Steps:** dashboard → unpublish. **Expect:** the public URL no longer renders the profile (404 or "not found").

---

## 6. Homepage / framing cases (per env)

| Case | Env | Expect |
|---|---|---|
| **E1** | prod (`checklyra.com`, logged out) | **Waitlist landing** — "We're opening Lyra a few people at a time", "Join the waitlist", **no** example band |
| **E2** | beta (`beta.checklyra.com`, logged out) | **Product homepage** — "Be understood.", "Find someone", **"A few people to meet" band with the 6 `@seed` examples** |
| **E3** | beta `/signup` | **"Join the Lyra waitlist"** (post-#397). Pre-#397 it wrongly says "Create account". |
| **E4** | beta/prod `/signup` | invite-code field shown when `LYRA_INVITE_CODE` is set — now configured on **both beta and prod** scopes |
| **E5** | any | the `@seed` examples are the **only** profiles in the band — a real user can never appear (anti-leak trigger restricts `is_homepage_example` to `@seed.checklyra.com`) |

---

## 7. MCP cases (run only if the release touches the MCP server)

| Case | Expect |
|---|---|
| **F1** | Adding/authenticating the prod connector shows **"Authenticate your Check Lyra account"** (not a blank `{}` — BUGS-59, via PRM `resource_name`). |
| **F2** | An authenticated **write** tool succeeds with a valid key; a non-entitled feature (e.g. Convene) is correctly gated off. |
| **F3** | `mcp.checklyra.com/.well-known/oauth-protected-resource` returns `resource_name:"Check Lyra"`; `…/mcp.json` `build_sha` == `origin/main`. |

---

## 7a. Beta-invite deep-link & dashboard share (KAN-337)

The shareable link `https://checklyra.com/join?code=<LYRA_INVITE_CODE>` skips the
waitlist for whoever clicks it — for **both** email magic-link and Google sign-up.
The dashboard shows it as a "Share beta access" card and embeds it in the share
message. The canonical link uses the **prod host** on the prod family (beta + prod
share the public front door); dev uses the dev host.

| Case | Steps | Expect |
|---|---|---|
| **G1** (link, logged out) | `curl -sI "https://<host>/join?code=<correct>"` | `307` → `Location: …/signup?invited=1`; `Set-Cookie: lyra_invite=<code>; HttpOnly; …; SameSite=lax` |
| **G1b** (bad/no code) | `curl -sI "https://<host>/join?code=wrong"` and `…/join` | `307` → `…/signup` (no `?invited=1`), **no** `Set-Cookie` |
| **G2** (email via link) | open `/join?code=<correct>` in a browser → `/signup` shows the green **"You've been invited…"** banner + no waitlist framing → sign up with a fresh `ben+tag@…` → open the magic link | lands in **beta** (dashboard, not `/waitlist`) |
| **G3** (Google via link) | open `/join?code=<correct>` → **Continue with Google** with a fresh account → consent | lands in **beta** — the cookie carried the code through OAuth → resolveBetaAccess granted |
| **G4** (dashboard share) | log in as a live beta user → dashboard | a **"Share beta access"** card shows the `…/join?code=…` link + Copy; the "Share Lyra" message CTA is the same link ("skips the waitlist") |
| **G5** (feature off) | env with `LYRA_INVITE_CODE` unset (e.g. dev) | `/join?code=x` → `/signup`, no cookie, no banner, no dashboard card |

DB check after G2/G3 (expect `live` / `beta`, no waitlist):
```sql
select user_status, access_tier from profiles p join auth.users u on u.id=p.user_id
where u.email='<addr>';
```

---

## 7b. Admin host isolation activation (SEC-37)

Active once `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` (+ `ADMIN_HOST_ENFORCED=true`)
are set on the env. The admin console then lives ONLY on the admin host behind
Cloudflare Access **and** an in-app JWT verify. Run this 4-/5-layer canary right
after activation (and on any release touching middleware / `cf-access.ts`):

| Layer | Check | Expect |
|---|---|---|
| **H1** (edge) | `curl -sIL https://<admin-host>/` (logged out) | `302` → `…cloudflareaccess.com/cdn-cgi/access/login/<admin-host>?…aud=<AUD>` |
| **H2** (host serves admin, no bounce) | logged-in admin opens `https://<admin-host>/` | serves the admin console (middleware rewrites `/`→`/admin`, **skips the beta gate** — this is the BUGS-56 "bounce to beta" fix) |
| **H3** (in-app JWT) | hit the Vercel origin / a `*.vercel.app` preview with `Host: <admin-host>` and **no** CF JWT | **403** `Forbidden: Cloudflare Access required` |
| **H4** (shared-host redirect) | `curl -sI https://checklyra.com/admin` | `30x` → `https://<admin-host>/admin` — `/admin` is never served on the public host |
| **H5** (is_admin still applies) | a non-admin who passes CF Access opens the admin host | `/admin` denied/404 — the `is_admin` gate still runs under the CF layer |

Per-env: dev `admin-dev.checklyra.com` (AUD `611d6bf7…`); prod `admin.checklyra.com`
(AUD `c59e6cee…`), team `checklyra.cloudflareaccess.com`. **Rollback** = unset the
CF env vars + redeploy → reverts to inert (`/admin` works on every host again).

---

## 8. Reset procedure (to re-run new-signup cases)

A `new-signup` case can only run once per address until the account is removed.
**Deleting prod accounts is destructive and irreversible — confirm the exact list
first, and NEVER touch `ben@santos-stephens.com` / `luisa@santos-stephens.com`.**

1. List the test accounts:
   ```sql
   select u.id, u.email, p.user_status from auth.users u
   left join profiles p on p.user_id=u.id
   where u.email ilike 'ben+%@santos-stephens.com'
      or u.email in ('ben@benstephens.co.uk');   -- explicit test addresses only
   ```
2. Confirm the list with the owner.
3. Delete (children first, then the user — FKs mostly cascade from `auth.users`):
   ```sql
   delete from auth.users where email in (<confirmed test addresses>);
   -- profiles / profile_items / oauth_* cascade via on delete cascade
   ```
4. Verify `select count(*) from auth.users where email ilike '<addr>'` → 0.

Preferred path where available: the **admin console** delete/suspend action
(audited), rather than raw SQL.

---

## 9. Sign-off log

Record each pass. Append a row per run:

| Run date | Env(s) | Release/SHA | A1 | A2 | A3 | A4 | B1 | B2 | C1 | C2 | C3 | D1 | D2 | E1–E5 | F1–F3 | Tester | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-06-28 | prod | (KAN-336 ship) | — | ✅ | — | — | — | ✅ | ✅ | ✅(failed)/manual | ✅ | ✅ | — | E1✅ | F1✅ | Claude+Ben | partial (ben E2E) |
| 2026-06-28 | beta | (gate verify) | ✅ | — | — | — | ✅ | — | — | — | — | — | — | E2✅ | — | Claude | gate proven |

> Aim for a **full row** (every case ✅) on dev and prod before signing off a
> release that touches this surface.
