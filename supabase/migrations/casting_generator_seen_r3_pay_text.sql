-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: casting_generator_seen_r3_pay_text  (2026-09-17)
-- Casting generator round 3: the pay box is written fresh for every listing
-- and its wording is retired for good, like schedule notes.
--   pay|<normalized pay text>   kind 'pay_text'   (numbers → #)
-- Additive only: every existing kind stays allowed.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.casting_generator_seen
  drop constraint if exists casting_generator_seen_kind_check;
alter table public.casting_generator_seen
  add constraint casting_generator_seen_kind_check
  check (kind is null or kind in ('story','backfill','character_name','crew_name','company','schedule_note','area','person_name','pay_text'));
