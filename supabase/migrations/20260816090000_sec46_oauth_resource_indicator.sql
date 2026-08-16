-- SEC-46 Phase C — RFC 8707 resource indicators on the authorization server.
--
-- WHAT THIS IS FOR
-- ----------------
-- Access tokens currently carry `aud = client_id`, and both resource servers
-- (mcp.checklyra.com and admin-mcp.checklyra.com) verify with issuer only. So
-- ONE token is accepted by BOTH today, and Dynamic Client Registration is open
-- — anyone can mint a client and receive a legitimately-signed token that every
-- resource server honours. Binding `aud` to the resource is what closes that
-- confused-deputy path (SEC-48's leg 2 is the same hole seen from the admin
-- side).
--
-- To bind `aud` at token-issue time, the resource chosen at /oauth/authorize has
-- to survive the code exchange — so it is persisted on the code row here, and on
-- the refresh row so a refreshed token stays bound to the same resource rather
-- than silently widening.
--
-- ⚠️ ORDERING — THIS ONE IS THE ORDINARY DIRECTION, AND IT IS SAFE EARLY.
-- Both columns are ADDITIVE and NULLABLE, so old code (which never writes or
-- reads them) is completely unaffected. Apply this to dev, staging AND
-- production BEFORE the Phase C code reaches any of them. A column that exists
-- before its writer is harmless; a writer that arrives before its column fails
-- every request with PGRST204, and `type-check` cannot catch it (CLAUDE.md,
-- Deployment Pipeline → "The database does not ride that chain").
--
-- Note this is the OPPOSITE ordering from the SEC-112 trigger migration, which
-- must land AFTER its code in each environment. Two migrations in flight with
-- opposite requirements is exactly the situation where "apply the migrations"
-- as a single instruction goes wrong — they are not interchangeable.
--
-- NULL means "issued before resource indicators existed", and the application
-- treats that as the environment's default resource rather than as an error, so
-- codes and refresh tokens in flight across the deploy keep working.
--
-- ROLLBACK:
--   alter table public.oauth_authorization_codes drop column if exists resource;
--   alter table public.oauth_refresh_tokens      drop column if exists resource;

alter table public.oauth_authorization_codes
  add column if not exists resource text;

alter table public.oauth_refresh_tokens
  add column if not exists resource text;

comment on column public.oauth_authorization_codes.resource is
  'SEC-46 / RFC 8707: canonical resource URI this code was authorized for. NULL = pre-Phase-C, treated as the environment default. Becomes the aud claim of the issued access token.';

comment on column public.oauth_refresh_tokens.resource is
  'SEC-46 / RFC 8707: carried forward so a refreshed access token stays bound to the resource the user originally consented to, rather than silently widening.';
