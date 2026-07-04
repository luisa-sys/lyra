-- KAN-404 #14: raise the conversation-starter answer cap from 5 to 10.
--
-- The original cap (5) was enforced by the BEFORE INSERT trigger
-- `pcs_cap` calling `public.enforce_pcs_cap()`, defined in
-- 20260516200000_conversation_starters.sql. This migration idempotently
-- redefines that function with the new limit of 10 and an updated
-- exception message. The trigger itself is unchanged (it already points
-- at this function), so only the function body needs replacing.
--
-- Apply to dev + staging ONLY. Do NOT apply to prod (production cap
-- change is gated on separate sign-off).
--   dev    (ilprytcrnqyrsbsrfujj): pending
--   stage  (uobmlkzrjkptwhttzmmi): pending
--   prod   (llzkgprqewuwkiwclowi): DO NOT APPLY

create or replace function public.enforce_pcs_cap()
returns trigger as $$
begin
  if (select count(*) from public.profile_conversation_starters where profile_id = new.profile_id) >= 10 then
    raise exception 'Conversation-starter answer limit (10) reached';
  end if;
  return new;
end$$ language plpgsql;
