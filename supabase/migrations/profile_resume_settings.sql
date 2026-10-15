-- Résumé builder choices (credits picked, photo framing, corner, size, footer, sections),
-- saved with the profile so the public "View résumé" matches what the actor built (2026-10-15).
-- Never holds the actor's email (that stays in their browser only).
alter table public.profiles add column if not exists resume_settings jsonb;
