-- SEC-76 (web-oauth-7) — DCR anti-phishing.
--
-- Dynamic Client Registration (RFC 7591) lets any party self-register an
-- OAuth client with an arbitrary client_name. A phishing client can register
-- as "Lyra Official" and the /oauth/authorize consent screen — which renders
-- client_name verbatim — gives the user no way to tell it apart from a real
-- first-party app.
--
-- Add an is_first_party flag. Every dynamically-registered client defaults to
-- FALSE and is surfaced as "Unverified app" on the consent screen. An admin
-- flips this to TRUE for genuinely first-party clients.
--
-- Rollback:
--   alter table public.oauth_clients drop column if exists is_first_party;

alter table public.oauth_clients
  add column if not exists is_first_party boolean not null default false;

comment on column public.oauth_clients.is_first_party is
  'SEC-76 — true only for admin-verified first-party OAuth clients. DCR (RFC 7591) clients default false and render as "Unverified app" on the consent screen.';
