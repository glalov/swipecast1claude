-- Third pass on the rotating email hero (2026-09-15). The owner reviewed the
-- 8 September batch and pulled 13 of the 20: all seven black-and-white
-- public-domain titles, plus six frames swapped for named stars (Depp,
-- Lawrence, Viola Davis, Jackie Chan, Dwayne Johnson, Jolie). Every new frame
-- is a scene still, not key art -- the first pass for Maleficent, Jumanji and
-- The Woman King picked poster composites and was redone from 24 candidate
-- backdrops per film.
--
-- Retired rows are deactivated rather than deleted, so the licence trail and
-- use_count history stay answerable. New rows go in with last_used_at NULL,
-- which puts them at the front of "last_used_at nulls first".

update public.email_hero_images
   set active = false
 where title in (
   'Past Lives',
   'Sing Sing',
   'The Holdovers',
   'Anatomy of a Fall',
   'Moonlight',
   'Battleship Potemkin',
   'Steamboat Bill, Jr.',
   'The Gold Rush',
   'Plan 9 from Outer Space',
   'House on Haunted Hill',
   'The Last Man on Earth',
   'Meet John Doe',
   'Blade Runner 2049'
 );

insert into public.email_hero_images
  (source,title,year,image_url,caption,subject_hook,style,accent,credit) values
  ('tmdb','Maleficent: Mistress of Evil',2019,'https://image.tmdb.org/t/p/w1280/6IPu4e3D0wyeeVfrSveE4RXqWjr.jpg','Jolie plays the whole part in the voice and the stillness — she barely moves and the scene still belongs to her.','The whole part is in the voice and the stillness','latenight','#BB7C4D','Still: Maleficent: Mistress of Evil'),
  ('tmdb','Jumanji: Welcome to the Jungle',2017,'https://image.tmdb.org/t/p/w1280/kcnyw8o4GmAPZzgStWhVYkbnyqG.jpg','Dwayne Johnson is playing a nervous teenager in a wrestler''s body, and it only works because he plays it completely straight.','A nervous kid in a wrestler''s body','marquee','#CAC873','Still: Jumanji: Welcome to the Jungle'),
  ('tmdb','The Foreigner',2017,'https://image.tmdb.org/t/p/w1280/cVJbtY0ZiBifv12XSEvKIk84zgY.jpg','Jackie Chan at sixty-three, no comedy and no stunts to hide behind. Just a man asking the same question until someone answers.','No stunts to hide behind, just the question','latenight','#97B5D7','Still: The Foreigner'),
  ('tmdb','The Woman King',2022,'https://image.tmdb.org/t/p/w1280/luD4aBjvZFMieeyPrRXD9xsTooI.jpg','Viola Davis trained for months for the fight scenes, then plays the quiet ones just as hard. Both take the same preparation.','The quiet scenes take the same preparation','latenight','#DF5829','Still: The Woman King'),
  ('tmdb','Pirates of the Caribbean: Dead Men Tell No Tales',2017,'https://image.tmdb.org/t/p/w1280/sAoUJAJtPqBLUcNNQHaVOjJ62oD.jpg','Depp built a franchise out of a walk and a voice. Physical choices travel further than lines do.','A walk and a voice built the whole part','marquee','#C8AB6F','Still: Pirates of the Caribbean: Dead Men Tell No Tales'),
  ('tmdb','Once Upon a Time in Hollywood',2019,'https://image.tmdb.org/t/p/w1280/oRiUKwDpcqDdoLwPoA4FIRh3hqY.jpg','Pitt and DiCaprio play a fading star and his stunt double, and their best scenes are just two men talking in a room.','Their best scenes are two men talking','latenight','#E5AA6E','Still: Once Upon a Time in Hollywood'),
  ('tmdb','Top Gun: Maverick',2022,'https://image.tmdb.org/t/p/w1280/kBSSbN1sOiJtXjAGVZXxHJR9Kox.jpg','The cast went through real G-force training so the faces in the cockpit would not have to be acted.','The reaction had to be real, so they flew it','marquee','#C1A65D','Still: Top Gun: Maverick'),
  ('tmdb','Knives Out',2019,'https://image.tmdb.org/t/p/w1280/fkdMSS93pFBzNW9OByNpi8i2UYg.jpg','Craig built that accent from nothing and never once winked at it. Commit to the choice and it carries the film.','Commit to the choice and never wink at it','latenight','#BB8F4D','Still: Knives Out'),
  ('tmdb','Barbie',2023,'https://image.tmdb.org/t/p/w1280/ctMserH8g2SeOAnCw5gFjdQF8mo.jpg','Robbie played a comedy completely straight. Sincerity is what makes the jokes land.','Played dead straight, which is why it is funny','marquee','#14B0F8','Still: Barbie'),
  ('tmdb','Sinners',2025,'https://image.tmdb.org/t/p/w1280/sqkSVOijtdqP1yPQ8vZidxXFauQ.jpg','Michael B. Jordan played both brothers, which means half his two-handers were played opposite nobody.','He played both brothers, opposite nobody','latenight','#D7CB97','Still: Sinners'),
  ('tmdb','La La Land',2016,'https://image.tmdb.org/t/p/w1280/2wmDyHz4gvF6m51IQZJnJzlLsnz.jpg','Emma Stone''s audition scene is one unbroken take, and the whole part turns on it.','The audition scene is one unbroken take','marquee','#3C7CCC','Still: La La Land'),
  ('tmdb','Dune: Part Two',2024,'https://image.tmdb.org/t/p/w1280/eZ239CUp1d6OryZEBPnO2n87gMG.jpg','Most of that performance happens in the eyes, under a hood, with the mouth covered.','Most of it happens in the eyes','marquee','#BB8B4D','Still: Dune: Part Two'),
  ('tmdb','Don''t Look Up',2021,'https://image.tmdb.org/t/p/w1280/1S4oUkZNGVmCBkRPCty8jmFRcRB.jpg','Jennifer Lawrence plays the only person in the room telling the truth, and gets talked over anyway.','The only one telling the truth, talked over','marquee','#97C0D7','Still: Don''t Look Up')
on conflict do nothing;
