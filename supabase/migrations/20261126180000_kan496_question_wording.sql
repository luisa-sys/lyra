-- KAN-496 (epic KAN-482) — wording fix for one v0.8 §09 preset question.
--
-- Founder feedback 2026-11-26: "What don’t you leave the house with?" should
-- read "What don’t you leave the house without?".
--
-- This is a typo fix, not a substantive rewrite, so the question KEEPS its
-- permanent ID (conversation_starter_prompts.id). Existing answers refer to
-- that ID and keep their meaning (KAN-484 rule: only a substantive rewrite
-- gets a new question ID). No row is deleted and no answer is touched.
--
-- Idempotent: a second run matches no row. If the corrected wording already
-- exists as its own row (e.g. added from the admin screen), the update is
-- skipped so the unique (prompt) constraint is never violated.
--
-- Rollback (manual):
--   update public.conversation_starter_prompts
--      set prompt = 'What don’t you leave the house with?'
--    where prompt = 'What don’t you leave the house without?';

update public.conversation_starter_prompts
   set prompt = 'What don’t you leave the house without?'
 where prompt = 'What don’t you leave the house with?'
   and not exists (
     select 1 from public.conversation_starter_prompts
      where prompt = 'What don’t you leave the house without?'
   );
