-- Seed pool for the rotating email hero. Captions hand-written per still.
insert into public.email_hero_images (source,title,year,image_url,caption,style,accent,credit) values
  ('tmdb','Sinners',null,'https://image.tmdb.org/t/p/w1280/nAxGnGHOsfzufThz20zgmRwKur3.jpg','Some rooms change what walks out of them. Three New York projects are casting this week.','latenight','#D48934','Still: Sinners'),
  ('tmdb','Weapons',null,'https://image.tmdb.org/t/p/w1280/8VyTWJrNEyV2MTWvniDVp0MpOAe.jpg','Everyone in town saw it. Nobody can describe it. Today''s roles are below.','latenight','#4D96BB','Still: Weapons'),
  ('tmdb','Wicked',null,'https://image.tmdb.org/t/p/w1280/fyZ6SDUS4o9jp2EHxfZa3qS9ean.jpg','Every ensemble you''ve ever loved started as a room full of people nobody had cast yet.','marquee','#E0B08E','Still: Wicked'),
  ('tmdb','Dune Part Two',null,'https://image.tmdb.org/t/p/w1280/eZ239CUp1d6OryZEBPnO2n87gMG.jpg','The desert doesn''t audition you twice. Neither does a casting director''s inbox.','marquee','#BB8B4D','Still: Dune Part Two'),
  ('tmdb','The Substance',null,'https://image.tmdb.org/t/p/w1280/8ODNt5olCeIqBYTP3GgXEQYTfeX.jpg','The industry''s favourite horror is being replaced. Here''s work that wants you as you are.','marquee','#C76C72','Still: The Substance'),
  ('tmdb','Anora',null,'https://image.tmdb.org/t/p/w1280/qvyOfwTC3qdbzkqdXWSSEMHtjBZ.jpg','The best performances of the year came from faces nobody knew in January.','latenight','#C68E69','Still: Anora'),
  ('tmdb','Conclave',null,'https://image.tmdb.org/t/p/w1280/eZzNdjNDvaSoyywy9ICg2UmFwul.jpg','A room of people deciding. On the other side of the door, someone waiting to hear.','latenight','#F41470','Still: Conclave'),
  ('tmdb','Twisters',null,'https://image.tmdb.org/t/p/w1280/58D6ZAvOKxlHjyX9S8qNKSBE9Y.jpg','Chasing the thing everyone else runs from is the entire job description.','marquee','#BB794D','Still: Twisters'),
  ('public_domain','Nosferatu',1922,'https://image.tmdb.org/t/p/w1280/cA9iGtvjRGJHzDBfrq48l0eyCvA.jpg','A hundred and four years on, it still works — shadow, silence, and one unbearable face.','latenight','#B5BB4E','Still: Nosferatu'),
  ('public_domain','Metropolis',1927,'https://image.tmdb.org/t/p/w1280/eeMoFKxjjiCi6iep2GEZtSAMYIr.jpg','They built the future out of extras. Thousands of them, uncredited, unforgettable.','latenight','#BB4D4D','Still: Metropolis'),
  ('public_domain','Sherlock Jr.',1924,'https://image.tmdb.org/t/p/w1280/tSipsYTp565LkopntX1lZNLPYHP.jpg','Keaton did his own stunts because nobody else would. Start where you can.','latenight','#D7D797','Still: Sherlock Jr.'),
  ('tmdb','Night of the Living Dead',1968,'https://image.tmdb.org/t/p/w1280/5KtmBSqFtHY3I9t8lgH27Mc0bqY.jpg','Shot for $114,000 by people with no permission. That''s still how most films start.','latenight','#BB4D75','Still: Night of the Living Dead'),
  ('tmdb','Carnival of Souls',1962,'https://image.tmdb.org/t/p/w1280/esIoQw7VaykfHsw6fx2VltZ1R7U.jpg','One organ, one lake, one actress. You don''t need a budget to be remembered.','latenight','#BB4D4D','Still: Carnival of Souls'),
  ('tmdb','His Girl Friday',1940,'https://image.tmdb.org/t/p/w1280/ihoQaiMFAz4YCTAaSIsQjRknsNH.jpg','Nobody has talked that fast since. Ninety takes of pure nerve.','latenight','#C36262','Still: His Girl Friday'),
  ('public_domain','The General',1926,'https://image.tmdb.org/t/p/w1280/mzox4HbcV9W42MH2dB1QsdDVGo3.jpg','The most expensive shot of the silent era. Done once, in a single take.','marquee','#BB4D4D','Still: The General'),
  ('tmdb','Detour',1945,'https://image.tmdb.org/t/p/w1280/uGOKN4VeCsf249zypWfaAzfTxAB.jpg','Six days, one road, no money. Noir was built by people improvising.','latenight','#BB4D4D','Still: Detour')
on conflict do nothing;
