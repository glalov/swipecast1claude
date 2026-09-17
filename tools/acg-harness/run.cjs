#!/usr/bin/env node
// Admin Casting Generator test harness.
//
//   node tools/acg-harness/run.cjs [--n 120] [--same-browser] [--json out.json] [--samples out.txt]
//
// Drives ACG exactly the way AdminCastingGenerator does: batches of 5, every
// saved listing fed back in as "existing", every durable key written to a
// simulated casting_generator_seen table. By default localStorage is WIPED
// between batches, which is what a second browser or device looks like — so
// anything the generator only remembers locally shows up here as a repeat.
const {loadACG}=require("./load.cjs");
const fs=require("fs");
const path=require("path");

const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf(k);return i>-1?args[i+1]:d;};
const N=parseInt(arg("--n","120"),10);
const SAME_BROWSER=args.includes("--same-browser");
const JSON_OUT=arg("--json",null);
const SAMPLES_OUT=arg("--samples",null);

const {ACG,store,parseRoleRate,src,ctx}=loadACG();
const WHY={};let ATTEMPTS=0,REJECTED=0;
const PROJECT_TYPE_OPTIONS=JSON.parse(src.match(/const PROJECT_TYPE_OPTIONS=(\[[^\]]*\])/)[1]);
// The generator's city pools, read from source so the "no repeat until the pool
// is spent" test knows how big each pool is.
const CITIES=(()=>{const m=src.match(/const CITIES=(\[[\s\S]*?\n  \]);/);return m?Function("return "+m[1])():[];})();

// ── Generate, the way the admin page does ───────────────────────────────────
const listings=[];const seenRows=[];
// --preused N: simulate production, where the live log already retires most
// premises (216 of 222 on 2026-09-16) — every seed but N starts as used.
if(args.includes("--preused")){
  const keep=parseInt(arg("--preused","6"),10)||6;
  const seeds=require("./dump-seeds.cjs");
  seeds.slice(keep).forEach(sd=>{seenRows.push({key:"seed "+sd.k.replace(/[^a-z0-9]+/g," ").trim(),kind:"story"});[sd.h,sd.h2].filter(Boolean).forEach(t=>seenRows.push({key:("story "+sd.k+" "+t).toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),kind:"story"}));});
}
const t0=Date.now();
let rounds=0;
while(listings.length<N&&rounds<N){
  rounds++;
  if(!SAME_BROWSER)store.clear();
  const seenArg=ACG.seenRowsFor?seenRows.slice():seenRows.map(r=>r.key);
  const batch=ACG.generateBatch("admin",listings.slice(),Math.min(5,N-listings.length),seenArg);
  const lr=ctx.__acgLastRun;if(lr){ATTEMPTS+=lr.attempts;REJECTED+=lr.rejected;Object.entries(lr.why||{}).forEach(([k,v])=>{WHY["build: "+k]=(WHY["build: "+k]||0)+v;});(lr.rejectLog||[]).forEach(x=>(x.problems.length?x.problems:["not fresh enough"]).forEach(p=>{const k=args.includes("--why-full")?p:p.replace(/:.*$/,"").replace(/ on .*$/,"");WHY[k]=(WHY[k]||0)+1;}));}
  for(const raw of batch){
    const roles=raw._roles||[];
    const item=Object.fromEntries(Object.entries(raw).filter(([k])=>k[0]!=="_"));
    const saved={...item,id:"L"+(listings.length+1),roles:roles.map(r=>({...Object.fromEntries(Object.entries(r).filter(([k])=>k[0]!=="_")),_isGroup:!!(r._group||/background/i.test(r.role_type||""))})),_raw:raw};
    listings.push(saved);
    if(ACG.seenRowsFor)ACG.seenRowsFor(raw).forEach(r=>seenRows.push(r));
    else ACG.seenKeysFor(raw).forEach(k=>seenRows.push({key:k,kind:"story"}));
  }
  if(!batch.length)break;
}
const ms=Date.now()-t0;

// ── Helpers ─────────────────────────────────────────────────────────────────
const clean=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const sentences=t=>(String(t||"").match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)||[]).map(x=>x.trim()).filter(Boolean);
const allText=L=>[L.title,L.tagline,L.synopsis,L.pay,L.submission_requirements,L.schedule_note,L.shoot_location,...L.roles.map(r=>`${r.name} ${r.description} ${r.pay}`)].join("\n");
const personText=L=>[L.title,L.tagline,L.synopsis,L.pay,L.submission_requirements,L.schedule_note,...L.roles.map(r=>`${r.description} ${r.pay}`)].join("\n");
const dayNum=d=>Math.round(new Date(String(d).slice(0,10)+"T00:00:00Z").getTime()/86400000);
const WORDNUM={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50};
const minAge=r=>{const m=String(r.age_range||"").match(/(\d+)\s*-\s*(\d+)/);return m?+m[1]:NaN;};
const maxAge=r=>{const m=String(r.age_range||"").match(/(\d+)\s*-\s*(\d+)/);return m?+m[2]:NaN;};
// A person, not a group label: the generator's own flag when present, else the shape of a name.
const isGroup=r=>r._isGroup!==undefined?r._isGroup:!/^[A-Z][a-zA-Z'’.-]+( [A-Z]\.)? [A-Z][a-zA-Z'’-]+(-[A-Z][a-zA-Z'’-]+)?$/.test(String(r.name||"").trim());

const FAM={
  film:/^(Feature Film|Short Film|Student Film|Independent Film|Experimental Film|Proof of Concept|Documentary)$/,
  tv:/^(TV Series|TV Pilot|Web Series|Streaming Series|Sizzle Reel|Pitch Trailer|Limited Series|Miniseries|Vertical Series|Pilot Presentation|Reality \/ Docu-Series|Lifestyle \/ Unscripted|Hosting \/ Presenter)$/,
  stage:/^(Theater|Off-Broadway Theater|Off-Off-Broadway Theater|Musical Theater|Workshop \/ Staged Reading|Table Read)$/,
  photo:/^(Modeling|Print Campaign|Photo Shoot)$/,
  audio:/^(Voiceover|Podcast \/ Audio Drama)$/,
  ad:/^(Commercial|Social Media Ad|Branded Content|Promo Video|Product Demo|Spec Commercial|Ad Campaign|Public Service Announcement|Influencer \/ UGC Content)$/,
  corp:/^(Corporate Video|Industrial \/ Training Video|Educational Video)$/
};
const famOf=t=>Object.keys(FAM).find(k=>FAM[k].test(t))||"other";
// What sentence one has to call the project, per type. Plain synonyms allowed.
const TYPE_WORDS={
  "Feature Film":/feature/i,"Short Film":/short film|\bshort\b/i,"Student Film":/student (film|short)/i,"Independent Film":/independent (feature|film)|indie (feature|film)/i,
  "Documentary":/documentary/i,"TV Series":/(tv|television) (series|show|drama|comedy)/i,"TV Pilot":/pilot/i,"Web Series":/web series|online series/i,
  "Streaming Series":/streaming (series|show|drama|comedy)/i,"Commercial":/commercial|\bad\b|\bspot\b|advert/i,"Social Media Ad":/social( media)? (ad|video|spot)/i,
  "Branded Content":/branded (content|film|video|short|series)/i,"Corporate Video":/corporate (video|film)|company video/i,"Industrial / Training Video":/training video|training film|industrial/i,
  "Promo Video":/promo/i,"Product Demo":/(product )?demo/i,"Music Video":/music video/i,"Voiceover":/voiceover|voice-over|voice (job|work|role|session)/i,
  "Podcast / Audio Drama":/podcast|audio (drama|series|play|story)/i,"Animation":/animat/i,"Video Game":/video game|\bgame\b/i,"Theater":/\bplay\b|stage (production|show)|theat(er|re) (production|show|piece)/i,
  "Off-Broadway Theater":/off-broadway/i,"Off-Off-Broadway Theater":/off-off-broadway/i,"Musical Theater":/musical/i,"Workshop / Staged Reading":/staged reading|workshop/i,
  "Live Event":/live (event|show|experience)|event/i,"Hosting / Presenter":/host|presenter/i,"Reality / Docu-Series":/docu-?series|reality (series|show)/i,
  "Lifestyle / Unscripted":/unscripted|lifestyle (series|show)/i,"Modeling":/model(ing)? (job|shoot|booking|campaign)|modeling/i,"Print Campaign":/print (campaign|ad)/i,
  "Photo Shoot":/photo ?shoot|photo series|portrait (series|shoot)/i,"Influencer / UGC Content":/ugc|creator (video|content|campaign)|influencer/i,
  "Educational Video":/educational (video|film|series)|lesson video|learning video/i,"Public Service Announcement":/public service announcement|\bpsa\b/i,
  "Spec Commercial":/spec (commercial|ad|spot)/i,"Proof of Concept":/proof[- ]of[- ]concept/i,"Sizzle Reel":/sizzle reel/i,"Pitch Trailer":/pitch trailer/i,
  "Table Read":/table read/i,"Experimental Film":/experimental (film|short)/i,"Dance Project":/dance (film|piece|project|video|work)/i,"Performance Art":/performance(-| )art|performance piece/i,
  "Background / Extras":/background|extras/i,"Stand-In":/stand-in/i,"Body Double":/body double|double/i,"Stunts":/stunt/i,"Motion Capture":/motion[- ]capture|mocap/i,
  "Limited Series":/limited series/i,"Miniseries":/miniseries|mini-series/i,"Vertical Series":/vertical series|vertical drama|phone series/i,"Pilot Presentation":/pilot presentation|presentation pilot/i,
  "Ad Campaign":/ad campaign|advertising campaign|\bcampaign\b/i
};

// ── Checks ──────────────────────────────────────────────────────────────────
// Each check returns [{id, detail}] of failures. `unit` says what a count means.
const checks=[];
const check=(step,key,label,fn,opt)=>checks.push({step,key,label,fn,once:!!(opt&&opt.once)});
const boardHooks=[];const boardLabels=[];

const INVERTED=[/everything worth knowing before that/i,/before any of that/i,/\bup to then\b/i,/everything after this follows from one thing/i,/we join it late/i,/it begins simply enough/i,/\bhere is the\b/i,/described out loud/i,/the setup behind it/i,/where it starts:/i,/underneath it,/i,/the story follows/i,/wind back/i,/rewind a little/i,/the easy half|the simple part:|the half that is actually the story|the other half:/i,/one detail carries the rest|the hinge of it/i,/it all comes back to one|all of it traces to|everything points back/i,/drop in halfway|open on the middle|start in the wrong place/i,/we come in after the worst|picks up mid-fall|damage already done/i,/is the one this lands on/i,/\bmeet [A-Z][a-z]+\./,/\bstart with [A-Z][a-z]+\./,/^[A-Z][a-z]+ first\./];
const LITERARY=[/like scripture/i,/enormous stillness/i,/played as light comedy/i,/has to be earned/i,/stillness is the whole instrument/i,/close to the bone/i,/sweetness with a blade/i,/allergic to sentiment/i,/the whole instrument/i,/a moral position/i,/nowhere to hide/i,/the size comes from/i,/signpost/i,/the thinking, not the finish/i,/the silences are not/i,/that is the whole trick/i,/near enough that it should be/i,/bad week, closely watched/i];
const STOCK_CLOSERS=[/first-time on-camera actors are genuinely fine here/i,/if the part fits you, send something\. that is the whole process/i,/you do not need credits to submit\. we read everything/i,/nothing supernatural, nothing clever/i,/the story is true, or near enough/i];

check(1,"first_sentence","Synopsis sentence 1 names the project type AND the story",L=>{
  const s1=sentences(L.synopsis)[0]||"";
  const re=TYPE_WORDS[L.type]||/./;
  const setup=L._raw._setupText||"";
  const kw=clean(setup).split(" ").filter(w=>w.length>3);
  const hit=kw.filter(w=>clean(s1).includes(w)).length;
  const story=kw.length<3||hit/kw.length>=0.5;
  const okType=re.test(s1);
  return okType&&story&&s1.split(/\s+/).length>=7?[]:[{detail:`${L.type}: "${s1}"`}];
});
check(1,"inverted_opener","Inverted / backwards / fragment / name-first openers",L=>{
  const syn=String(L.synopsis||"");
  const s1=sentences(syn)[0]||"";
  const out=[];
  INVERTED.forEach(re=>{if(re.test(syn))out.push({detail:`${re}: "${s1}"`});});
  if(s1.split(/\s+/).length<5)out.push({detail:`fragment opener: "${s1}"`});
  const firsts=L.roles.filter(r=>!isGroup(r)).map(r=>r.name.split(" ")[0]);
  if(firsts.some(n=>new RegExp("^"+n+"\\b").test(s1)))out.push({detail:`character name before premise: "${s1}"`});
  return out.slice(0,1);
});
check(1,"literary","Literary phrasing",L=>{const t=allText(L);return LITERARY.filter(re=>re.test(t)).map(re=>({detail:String(re)}));});
check(1,"banned_words","'genuinely' / 'honestly' / 'straightforward'",L=>{const m=allText(L).match(/\b(genuinely|honestly|straightforward)\b/gi);return m?[{detail:m.join(",")}]:[];});
check(1,"ambiguous","Sentences that read two ways ('X is for people who…')",L=>/\b(ad|spot|film|video|campaign|show|project) is for (people|anyone|those) who\b/i.test(allText(L))?[{detail:"is for people who"}]:[]);
check(1,"insulting","Words that could insult actors (regular-looking, plain, average…)",L=>{const m=personText(L).match(/\b(regular-looking|ordinary-looking|normal-looking|average-looking|plain-looking|average (face|build|looks?|person|people)|plain (face|looks?|people)|unattractive|ugly|frumpy|homely|not like models)\b/gi);return m?[{detail:m.join(",")}]:[];});
check(1,"tagline_metadata","Tagline is metadata, not a story hook",L=>{
  const t=String(L.tagline||"");
  const bad=!t||/\b\d+ (roles?|parts?|bookings?)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d/i.test(t)||/submissions close|\bdeadline (is )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d)|now casting|breakdown|local hire|non-union|sag-aftra|\baea\b|\b\d+ (shoot days?|sessions?)\b/i.test(t)
    ||(L.shoot_location&&t.includes(String(L.shoot_location).split(" (")[0]))||t.includes(L.location)||/\b(\w+) \1\b/i.test(t)||t.split(/\s+/).length<5
    ||clean(t).startsWith(clean(L.type));
  return bad?[{detail:t}]:[];
});
check(1,"role_name_tacked","Role description names the character/role at the end, not first",L=>{
  const out=[];
  L.roles.filter(r=>!isGroup(r)).forEach(r=>{
    const d=String(r.description||"");
    if(/\bThat is (the|a|an|[A-Z][a-z]+)\b[^.]*\.\s*$/.test(sentences(d).slice(0,2).join(" "))||/\. [A-Z][a-z]+ is the [^.]+\.\s*$/.test(sentences(d).slice(0,2).join(" "))||/^Looking for someone to play/.test(d))out.push({detail:`${r.name}: ${d.slice(0,90)}`});
  });
  return out;
});

check(2,"stock_closers","Stock closing lines stapled on",L=>STOCK_CLOSERS.filter(re=>re.test(L.synopsis)).map(re=>({detail:String(re)})));
check(2,"repeated_sentences","Sentence reused across listings (synopsis, tagline, role text, schedule note)",null); // board-level, below
check(2,"closing_repeats","Synopsis closing line reused across listings",null);
check(2,"opening_skeleton","Opening structure reused by >10% of listings / adjacent listings share first 4 words",null);
check(2,"similar_story","Stories too similar to another listing (word overlap)",null);
check(2,"voice_spread","Distinct voices: no voice on >25% of listings",null);
check(2,"addon_mismatch","Role add-on line doesn't fit role/type",L=>{
  const out=[];const fam=famOf(L.type);
  L.roles.forEach(r=>{
    const d=String(r.description||"");
    if(/hold the product|product (stays )?in your hands|use the thing being sold/i.test(d)&&!/^(Commercial|Product Demo|Social Media Ad|Spec Commercial|Ad Campaign|Promo Video|Influencer \/ UGC Content|Print Campaign)$/.test(L.type))out.push({detail:`${L.type} product line: ${r.name}`});
    if(/how long you have been doing it|cast on the skill/i.test(d)&&!/danc|skat|music|athlet|chef|cook|stunt|rider|climb|drumm|singer|guitar|boxer|fighter|barber|swim|juggl|acrobat|skill|apprentice|maker|craft|mechanic|baker|runner|player/i.test(r.name+" "+sentences(d).filter(x=>!/cast on the skill|how long you have been|really be able to do this/i.test(x)).join(" ")))out.push({detail:`skill line on acting role: ${r.name}`});
    if(/makeup app|filters/i.test(d)&&/^(Corporate Video|Industrial \/ Training Video|Educational Video|Voiceover|Podcast \/ Audio Drama)$/.test(L.type))out.push({detail:`makeup-app line on ${L.type}`});
  });
  if(/^(stage|photo|audio)$/.test(fam)){
    const t=personText(L);if(/\bfilms?\b|\bfilmed\b|\bfilming\b|on camera/i.test(t))out.push({detail:`"film" in ${L.type}: ${(t.match(/[^.]*\b(films?|filmed|filming|on camera)\b[^.]*\./i)||[""])[0].slice(0,100)}`});
  }
  return out;
});

check(3,"type_spread","Project types drawn evenly across PROJECT_TYPE_OPTIONS",null);
check(3,"generic_brand_title","Generic brand titles (Top-Selling / Widely Advertised / Well-Known X Brand)",L=>/\b(top-selling|widely advertised|well-known|household-name|leading|major|popular|global|nationwide|national)\b.*\bbrand\b/i.test(L.title)||/\bBrand\b/.test(L.title)?[{detail:L.title}]:[]);
check(3,"title_story_mismatch","Title / tagline / synopsis / type describe different projects",L=>{
  const out=[];
  const other={podcast:/\bpodcast\b/i,"music video":/\bmusic video\b/i,"training":/\btraining (video|series|film)\b/i,"commercial":/\bcommercial\b/i,"photo shoot":/\bphoto ?shoot\b/i,"feature":/\bfeature film\b/i,"short film":/\bshort film\b/i,"play":/\b(the|this|a) play\b/i,"musical":/\bmusical\b/i,"series":/\b(web|tv|streaming|limited) series\b/i,"dance":/\bdance (film|piece|project)\b/i,"psa":/\bpublic service announcement\b|\bPSA\b/,"documentary":/\bdocumentary\b/i};
  const own=TYPE_WORDS[L.type]||/$^/;
  // The title, and the words of sentence one where the project noun sits.
  const blob=`${L.title} ${(sentences(L.synopsis)[0]||"").split(/\s+/).slice(0,6).join(" ")}`;
  Object.entries(other).forEach(([k,re])=>{const m=blob.match(re);if(m&&!own.test(m[0])&&!(k==="series"&&/series/i.test(L.type))&&!(k==="commercial"&&/commercial/i.test(L.type))&&!(famOf(L.type)==="other"&&/^(Background|Stand-In|Body Double|Stunts)/.test(L.type)&&/film|series/i.test(m[0])))out.push({detail:`${L.type} but says "${m[0]}": ${L.title}`});});
  const cat=String(L.title).match(/^(?:[\w-]+ )?([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:Brand|Commercial|Promo|Ad Campaign|Social Campaign|Brand Video|Digital Spot|Promo Shoot|Content Shoot)\b/)||String(L.title).match(/ — ([A-Z][\w']+(?: [A-Z][\w']+)?) (?:Commercial|Social Ad|Branded Video|Promo|Product Demo|Spec Ad|Ad Campaign|PSA|UGC Campaign|Print Campaign|Photo Shoot|Campaign)$/);
  if(cat){const w=clean(cat[1]).split(" ")[0].replace(/s$/,"");if(!clean(L.synopsis+" "+L.tagline).includes(w.slice(0,5)))out.push({detail:`title category "${cat[1]}" not in story: ${L.title}`});}
  return out;
});
check(3,"photo_rules","Photo/print/modeling: no dialogue, reel, self-tape, or 'film'",L=>{
  if(famOf(L.type)!=="photo")return[];
  const out=[];const t=personText(L);
  if(/\b(lines?|dialogue|speak|says|talk(s|ing)? (straight )?(in)?to the camera)\b/i.test(L.roles.map(r=>r.description).join(" ")))out.push({detail:"dialogue"});
  if(/\breel\b|self-tape|selftape/i.test(L.submission_requirements)||L.roles.some(r=>(r.required_media||[]).includes("reel")||r.prescreen==="selftape"))out.push({detail:"reel/self-tape"});
  if(/\bfilms?\b|filmed|filming|on camera/i.test(t))out.push({detail:"film"});
  return out;
});
check(3,"audio_rules","Voiceover/podcast: no face/headshot-driven lines; voice sample required",L=>{
  if(famOf(L.type)!=="audio")return[];
  const out=[];const t=personText(L);
  if(/\byour face\b|\bon camera\b|close-?ups?|\bheadshot is\b|cast (almost entirely )?on the face|looks? like/i.test(t))out.push({detail:(t.match(/[^.]*(your face|on camera|close-?up|on the face|looks? like)[^.]*\./i)||[""])[0].slice(0,100)});
  if(!/voice|demo|audio|sample|recording/i.test(L.submission_requirements))out.push({detail:"no voice sample asked"});
  return out;
});
check(3,"stage_rules","Theater: rehearsal/performance language, not shoot days",L=>{
  if(famOf(L.type)!=="stage")return[];
  const t=personText(L);const m=t.match(/[^.]*\b(shoot(s|ing)?|shoot days?|on set|call sheet|wrap)\b[^.]*\./i);
  return m?[{detail:m[0].slice(0,110)}]:[];
});

check(4,"nyc_share","NYC share of listings (target ~60%)",null);
check(4,"area_repeat_early","Neighborhood repeated before that city's pool was used up",null);
check(4,"area_max","Most uses of one neighborhood",null);
check(4,"venue_present","Shoot location names a specific venue type",L=>{
  const loc=String(L.shoot_location||"");
  // "A laundromat, Astoria, Queens (New York, NY)" — a venue phrase before the area.
  return /^(A|An|The|Remote)\b[^,]*,/.test(loc)?[]:[{detail:loc}];
});
check(4,"venue_broken","Venue phrase cut off mid-phrase (\"…in a,\")",L=>/\b(in|on|at|a|an|the|of|with|for|and|to|by|from),\s/i.test(String(L.shoot_location||"").split(" (")[0])?[{detail:L.shoot_location}]:[]);
check(4,"venue_fits","Venue/area fits the story (water, boardwalk, etc.)",L=>{
  const syn=clean(L.synopsis+" "+L.title);const loc=clean(L.shoot_location);
  const out=[];
  // A recording booth, theater or soundstage is where the work happens, not where the story is set.
  if(/studio|booth|theater|soundstage|capture stage|rehearsal|conference room|writers room|broadway house|playhouse/.test(loc))return out;
  if(/\bferry\b|\bharbou?r\b|\bpier\b|(?<!loading )\bdocks?\b|\bwaterfront\b/.test(syn)&&!/ferry|harbo|pier|dock|waterfront|marina|red hook|staten|st george|stapleton|rockaway|city island|coney|brighton|dumbo|battery|long island city|greenpoint|sunset park|bay ridge|east boston|fells point|bywater|algiers|san pedro|navy yard|seaport|beach|shore|wharf|port|bay|lake|river|canal|boardwalk|marina|sheepshead|williamsburg|canarsie|astoria|inwood|two bridges|financial district|tribeca|hunts point|throggs|tottenville|chelsea|mott haven|venice|santa monica|rogers park|uptown|hyde park|south loop|dorchester|charlestown|fishtown|old city|riverfront|paulus hook|downtown jersey|liberty state|bywater|irish channel|holy cross|lawrenceville|north side|braddock|strip district|millvale|zilker|riverside|jefferson-chalmers|rivertown|delray|fells point|canton|locust point|shelby park|coconut grove|biscayne|ballard|fremont|west seattle|st johns|sellwood|longfellow|cedar-riverside|nokomis|barrio logan|ocean beach|point loma|national city|thunderbolt|tybee|isle of hope|fox point|pawtucket|kingston|beacon|newburgh|poughkeepsie|hudson|catskill|montauk|freeport|patchogue|greenport|yonkers|new rochelle|peekskill|tarrytown|ossining|fair haven|city point|long wharf|east boston|quincy|south boston|san pedro/.test(loc))out.push({detail:`water story at ${L.shoot_location}`});
  if(/\bboardwalk\b|\barcade\b.*\bbeach\b/.test(syn)&&!/boardwalk|coney|rockaway|brighton|beach|shore|asbury|venice|santa monica|seaside|wildwood|atlantic city|long beach|tybee/.test(loc))out.push({detail:`boardwalk story at ${L.shoot_location}`});
  return out;
});

check(5,"sched_note_repeat","Schedule note (or a sentence of it) reused across listings",null);
check(5,"sched_stock","Stock schedule phrases present",L=>/build the schedule around the cast|nothing runs past|expect a read-through before|exact days are confirmed at booking|individual call days are set once/i.test(L.schedule_note)?[{detail:L.schedule_note}]:[]);
check(5,"block_shoot_logic","'Block shoot / back to back' with <2 days or days that don't fit the window",L=>{
  const n=String(L.schedule_note||"");
  if(!/back to back|block shoot|consecutive/i.test(n))return[];
  const days=shootDays(L);const win=dayNum(L.shoot_end)-dayNum(L.shoot_start)+1;
  return days<2||days>win||/\bone (shoot )?day\b/i.test(n)?[{detail:`${days} days / ${win}-day window: ${n}`}]:[];
});
check(5,"readthrough_wrong_type","Read-through promised on a commercial/photo shoot",L=>/^(ad|photo|corp)$/.test(famOf(L.type))&&/read-?through|table read/i.test(L.schedule_note+" "+L.roles.map(r=>r.description).join(" "))?[{detail:L.schedule_note}]:[]);
function shootDays(L){
  if(L._raw&&L._raw._shootDays)return L._raw._shootDays;
  const t=`${L.schedule_note} ${L.pay}`.toLowerCase();
  const m=t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(shoot days?|sessions?|days?|shoot day)\b/);
  if(m)return WORDNUM[m[1]]||+m[1];
  return Math.max(1,...L.roles.map(r=>+r.est_days||1));
}
check(5,"sched_same_topic","Schedule note states the same fact twice / blocks ≥ days",L=>{
  const n=String(L.schedule_note||"");const out=[];
  ["rehears","fitting","call sheet","teacher","transport|van leaves","break","dark"].forEach(t=>{const re=new RegExp(t,"i");if(sentences(n).filter(x=>re.test(x)).length>1||(n.match(new RegExp(t,"gi"))||[]).length>1)out.push({detail:`"${t}" twice: ${n}`});});
  const m=n.match(/\b(\w+) (?:shoot days|sessions|days|event days|capture days)[^.;]*split into (\w+) blocks/i);
  if(m){const d=WORDNUM[m[1].toLowerCase()]||+m[1],b=WORDNUM[m[2].toLowerCase()]||+m[2];if(b>=d)out.push({detail:n});}
  return out;
});
check(5,"sched_hours","Impossible hours: early call + overnight wrap on a one-day job, or 7+ consecutive days",L=>{
  const n=String(L.schedule_note||"");const out=[];
  if(/\b(one|single) (shoot|recording|event|capture) (day|session)\b/i.test(n)&&/\b\d{1,2}(:\d\d)?am call|starting at \d{1,2}(:\d\d)?am/i.test(n)&&/wrap by [1-5]am|overnight/i.test(n))out.push({detail:n});
  const c=n.match(/\b(\w+) (?:shoot days|days) (?:run back to back|are consecutive|in a row)|block of (\w+) shoot days in a row/i);
  if(c){const v=WORDNUM[String(c[1]||c[2]).toLowerCase()]||+(c[1]||c[2]);if(v>6)out.push({detail:n});}
  return out;
});
check(5,"series_days","Series/feature/limited/mini shoot days realistic",L=>{
  const need={"Feature Film":12,"Independent Film":10,"TV Series":8,"Streaming Series":8,"Limited Series":12,"Miniseries":12,"TV Pilot":5,"Pilot Presentation":3,"Web Series":3,"Vertical Series":3,"Documentary":5,"Reality / Docu-Series":5}[L.type];
  if(!need)return[];const d=shootDays(L);return d<need?[{detail:`${L.type} with ${d} shoot days`}]:[];
});
check(5,"days_window_deadline","Role est_days ≤ shoot days ≤ window; deadline before shoot start",L=>{
  const out=[];const days=shootDays(L);const win=dayNum(L.shoot_end)-dayNum(L.shoot_start)+1;
  if(famOf(L.type)!=="stage"&&days>win)out.push({detail:`${days} days in ${win}-day window`});
  L.roles.forEach(r=>{if(+r.est_days>days)out.push({detail:`${r.name} est_days ${r.est_days} > ${days}`});});
  if(!(dayNum(L.deadline)<dayNum(L.shoot_start)))out.push({detail:`deadline ${L.deadline} not before start ${L.shoot_start}`});
  return out;
});

check(6,"char_name_repeat","Character full names reused",null);
check(6,"crew_name_repeat","Crew full names reused (incl. crew = a character)",null);
check(6,"company_core_repeat","Company name core reused",null);
check(6,"surname_3plus","Surname used 3+ times within any 50-listing window",null);
check(6,"surname_same_listing","Two people with the same surname in one listing or adjacent listings",null);
check(6,"person_as_company","A person's name in the company / posted-by field",L=>{
  const crew=(L._raw._crewNames||[]);
  const blob=`${L.prod} | ${L.posted_by_label}`;
  return crew.some(n=>blob.includes(n))||/ — (Prod|Dir|Casting|Producer|Director|Photographer)\b|\bCasting for\b| Casting$/.test(blob)?[{detail:blob}]:[];
});
check(6,"cd_name_not_person","casting_director_name is not just a person's name",L=>{
  const v=String(L.casting_director_name||"").trim();
  return /^[A-Z][a-zA-Z'’-]+( [A-Z]\.)? [A-Z][a-zA-Z'’-]+(-[A-Z][a-zA-Z'’-]+)?$/.test(v)&&v!==L.prod?[]:[{detail:v}];
});
check(6,"bad_role_labels","Role names like Featured / Stand-in / Crowd / (Featured) / A) / 1) / Customer 1",L=>L.roles.filter(r=>/\bFeatured\b|\bStand-?in\b|\bCrowd\b|\((Featured|Group [A-Z]|Day 1|Wide Frames|Group A|Group B)\)|(^|\s)[A-Z]\)|\d\)|\b\w+ \d+$/.test(r.name)).map(r=>({detail:r.name})));
check(6,"placeless_group_label","Background label that names a place, not people (\"Shop (Background)\")",L=>L.roles.filter(r=>/\(Background\)$/.test(r.name)&&!/\b(people|customers|regulars|neighbors|passersby|patrons|guests|shoppers|riders|students|kids|children|audience|onlookers|workers|staff|crew|team|class|famil|dancers|players|gardeners|volunteers|traders|members|visitors|diners|commuters|passengers|voices|ensemble|group|atmosphere|double|model|hands|friends|coworkers|parents|fans|runners|swimmers|drivers|band|choir|chorus|tenants|mourners|guards|officers|nurses|patients|travelers|spectators|bidders|campers|queue|line)/i.test(r.name)).map(r=>({detail:r.name})));
check(6,"stage_manager_poster","Stage Manager as poster/contact credit",L=>/stage manager/i.test(`${L.prod} ${L.posted_by_label} ${L.casting_director_name}`)?[{detail:L.prod}]:[]);

check(7,"union_pay","SAG-AFTRA role under $200/day or unpaid",L=>{
  const out=[];
  L.roles.forEach(r=>{
    const rt=parseRoleRate(r.pay);
    if(/SAG/i.test(L.union_status)){
      if(!rt)out.push({detail:`${r.name}: unpaid on ${L.union_status}`});
      else if(rt.rate_unit==="day"&&rt.rate_amount<200)out.push({detail:`${r.name} ${r.pay}`});
      else if(rt.rate_unit==="flat"&&rt.rate_amount<200)out.push({detail:`${r.name} ${r.pay}`});
    }
  });
  return out;
});
check(7,"aea_pay","AEA contract listing under a realistic weekly minimum ($500/wk)",L=>{
  const out=[];
  if(/^AEA$|AEA \(|LOA|LORT/i.test(L.union_status))L.roles.forEach(r=>{const rt=parseRoleRate(r.pay);if(!rt||(rt.rate_unit==="week"&&rt.rate_amount<500))out.push({detail:`${r.name} ${r.pay} on ${L.union_status}`});});
  return out;
});
check(7,"nonunion_rate_fit","Non-union rates fit the type",L=>{
  if(/SAG|AEA/i.test(L.union_status))return[];
  const cap={ad:1500,photo:2000,corp:1200,film:700,tv:800,stage:1200,audio:1200,other:1200}[famOf(L.type)];
  const out=[];
  L.roles.forEach(r=>{const rt=parseRoleRate(r.pay);if(rt&&rt.rate_unit==="day"&&rt.rate_amount>cap)out.push({detail:`${L.type} ${r.pay}`});});
  if(/^(Student Film|Experimental Film|Table Read)$/.test(L.type))L.roles.forEach(r=>{const rt=parseRoleRate(r.pay);if(rt&&rt.rate_unit==="day"&&rt.rate_amount>350)out.push({detail:`${L.type} ${r.pay}`});});
  return out;
});
check(7,"fake_ranges","Pay ranges too narrow to be believable ($800–$850)",L=>{
  const out=[];const t=[L.pay,...L.roles.map(r=>r.pay)].join(" | ");
  (t.match(/\$[\d,]+\s*(?:–|-|to)\s*\$?[\d,]+/g)||[]).forEach(m=>{const [a,b]=m.match(/[\d,]+/g).map(x=>+x.replace(/,/g,""));if(b>a&&(b-a)/a<0.15)out.push({detail:m});if(b<a)out.push({detail:"reversed "+m});});
  return out;
});
check(7,"weekly_short_job","Weekly pay language on a short (≤5 day) non-stage job",L=>famOf(L.type)!=="stage"&&shootDays(L)<=5&&/\bweekly\b|per week|a week\b|\/week|each week/i.test(L.pay+" "+L.roles.map(r=>r.pay).join(" "))?[{detail:L.pay}]:[]);
check(7,"pronoun_gender","Pronouns contradict the role's gender",L=>{
  const out=[];
  L.roles.forEach(r=>{
    const d=" "+String(r.description||"")+" ";const g=String(r.gender||"");
    // Self-referential pronouns only: a sentence that opens on She/He is about
    // this character; "his father" in the middle of a line is someone else.
    const she=/(?:^|[.;!?]\s+)(She|Her)\b/.test(d),he=/(?:^|[.;!?]\s+)(He|His|Him)\b/.test(d);
    const anyG=/any gender|open on gender|without a fixed gender/i.test(d)||/^(All genders|Any|Non-binary|Nonbinary)$/i.test(g);
    if(/^Male$/i.test(g)&&she)out.push({detail:`${r.name} Male + she`});
    const anyShe=/\b(she|her|herself)\b/i.test(d),anyHe=/\b(he|him|his|himself)\b/i.test(d);
    if(/^Male$/i.test(g)&&anyShe&&!anyHe)out.push({detail:`${r.name} Male, description only says she`});
    if(/^Female$/i.test(g)&&anyHe&&!anyShe)out.push({detail:`${r.name} Female, description only says he`});
    if(/^Female$/i.test(g)&&he)out.push({detail:`${r.name} Female + he`});
    if(anyG&&(she||he)&&!(she&&he))out.push({detail:`${r.name} any-gender + ${she?"she":"he"}`});
    if(/any gender|open on gender|without a fixed gender/i.test(d)&&/^(Male|Female)$/i.test(g))out.push({detail:`${r.name} "any gender" but gender=${g}`});
  });
  return out;
});
check(7,"age_fit","Age range contradicts the character",L=>{
  const out=[];
  L.roles.forEach(r=>{
    const d=String(r.description||"")+" "+r.name;const lo=minAge(r),hi=maxAge(r);if(!isFinite(lo))return;
    if(/\bveteran\b|\bretired\b|\bdecades\b|\bgrand(mother|father|parent)\b|\bwidow(er)?\b/i.test(d)&&hi<35)out.push({detail:`${r.name} ${r.age_range}: veteran/retired`});
    const y=d.match(/\b(\d+|ten|twelve|fifteen|twenty|thirty|forty|fifty)\s+years\b(?! old| from| ago| later| younger| older)/i);
    if(y){const n=WORDNUM[y[1].toLowerCase()]||+y[1];if(n+16>hi)out.push({detail:`${r.name} ${r.age_range}: "${y[0]}"`});}
    if(/\b(teen(age|ager)?|high school|sixteen|seventeen)\b/i.test(d)&&lo>=21)out.push({detail:`${r.name} ${r.age_range}: teen`});
    if(/\b(child|kid|eight-year-old|ten-year-old)\b/i.test(d.split(/[.;]/)[0])&&lo>=16&&!/\b(her|his|their|a|the|elder|younger|adult|grown|oldest|youngest|either|both|each|every|any|no|eldest|middle|only) (child|kid)|child's|kid's/i.test(d))out.push({detail:`${r.name} ${r.age_range}: child`});
  });
  return out;
});
check(7,"minors","Minor note only with minor roles; no minors in mature material",L=>{
  const minor=L.roles.some(r=>minAge(r)<18);
  const note=/minor|guardian|child performer/i.test(L.submission_requirements);
  const out=[];
  if(note&&!minor)out.push({detail:"minor note, no minor roles"});
  if(minor&&!note)out.push({detail:"minor role, no guardian note"});
  if(minor&&(L.has_nudity||/\b(nudity|sexual|graphic violence|drug use|overdose|gore|explicit)\b/i.test(L.synopsis+" "+L.roles.map(r=>r.description).join(" "))))out.push({detail:"minor in mature material"});
  return out;
});
check(7,"scene_partners","Every name in 'Scenes with / Plays opposite' exists in the cast",L=>{
  const names=new Set(L.roles.map(r=>r.name));const out=[];
  L.roles.forEach(r=>{const d=String(r.description||"");(d.match(/(?:opposite|scenes (?:are )?with|with|against) ((?:[A-Z][A-Za-z'’-]+ ){1,2}[A-Z][A-Za-z'’-]+)/g)||[]).forEach(m=>{const n=m.replace(/^(opposite|scenes (are )?with|with|against) /i,"");if(/^[A-Z][a-z]+ [A-Z]/.test(n)&&!names.has(n)&&L.roles.some(x=>x.name.split(" ")[0]===n.split(" ")[0]))out.push({detail:n});});});
  return out;
});
check(7,"submission_type","Submission requirements match the type",L=>{
  const out=[];const f=famOf(L.type);const s=String(L.submission_requirements||"");
  if(f==="photo"&&/\breel\b|self-tape/i.test(s))out.push({detail:"reel/self-tape on photo"});
  if(f==="audio"&&!/voice|demo|sample|audio|recording/i.test(s))out.push({detail:"headshot-only on audio"});
  if(/Musical Theater/.test(L.type)&&!/sing|song|bars/i.test(s))out.push({detail:"musical with no song"});
  if(/Dance Project/.test(L.type)&&!/movement|dance|footage/i.test(s))out.push({detail:"dance with no movement clip"});
  return out;
});
check(7,"blanks_grammar","Blank fields, placeholders, doubled words, broken grammar",L=>{
  const out=[];
  ["title","type","prod","casting_director_name","tagline","synopsis","location","pay","union_status","submission_requirements","shoot_start","shoot_end","shoot_location","schedule_note","deadline"].forEach(k=>{if(!String(L[k]||"").trim())out.push({detail:"blank "+k});});
  if(!L.roles.length)out.push({detail:"no roles"});
  L.roles.forEach(r=>["name","description","gender","age_range","pay"].forEach(k=>{if(!String(r[k]||"").trim())out.push({detail:`blank role ${k}`});}));
  const t=allText(L);
  if((/undefined|\bnull\b|\[object|\{\{|\$\{|\bTBD\b|lorem ipsum/i.test(t)||/\bNaN\b/.test(t)))out.push({detail:"placeholder"});
  const dbl=t.match(/\b([a-z]+)\s+\1\b/i);if(dbl&&!/^(that|had|very|bye|no)$/i.test(dbl[1]))out.push({detail:`doubled "${dbl[0]}"`});
  if(/(^|[^\w'’])(a|an|the)\s+(a|an|the)\b|\s[,.;:]|\.\.(?!\.)|,,|\(\s*\)/i.test(t))out.push({detail:(t.match(/.{0,30}(\b(a|an|the)\s+(a|an|the)\b|\s[,.;:]|\.\.(?!\.)|,,|\(\s*\)).{0,20}/i)||[""])[0]});
  if(/(^|[^\w'’])a [aeiou]\w/i.test(t.replace(/\ba (one|uni|use|usu|euro|eu|ubi|uti)/gi,"")))out.push({detail:(t.replace(/\ba (one|uni|use|usu|euro|eu|ubi|uti)/gi,"").match(/.{0,20}(^|[^\w'’])a [aeiou]\w+/i)||[""])[0]});
  return out;
});
check(7,"film_word_nonfilm","\"the film\" on a live, music, dance or motion-capture listing",L=>/^(Live Event|Hosting \/ Presenter|Music Video|Dance Project|Performance Art|Motion Capture)$/.test(L.type)&&/\b(the|this|whole) film\b/i.test(personText(L))?[{detail:(personText(L).match(/[^.]*\b(the|this|whole) film\b[^.]*\./i)||[""])[0].slice(0,100)}]:[]);
check(7,"group_one_gender","A group part (ensemble, regulars…) cast as a single gender",L=>L.roles.filter(r=>/\b(Ensemble|Regulars|Players|Neighbors|Customers|Patrons|Riders|Guests|Shoppers|Onlookers|Voices|Kids|Students|Dancers|Passersby|Crew|Team|Class)\b/.test(String(r.name).split(/ for | \(/)[0])&&/^(Male|Female)$/.test(r.gender)).map(r=>({detail:`${r.name} ${r.gender}`})));
check(7,"pay_rank_order","A smaller part paid more than a bigger one",L=>{
  const rk=r=>/^(Lead|Principal|Principal Voice)$/i.test(r.role_type)?0:/background|ensemble/i.test(r.role_type)?3:/day player|featured/i.test(r.role_type)?2:1;
  const out=[];L.roles.forEach(a=>L.roles.forEach(b=>{const ra=parseRoleRate(a.pay),rb=parseRoleRate(b.pay);if(ra&&rb&&ra.rate_unit===rb.rate_unit&&rk(a)<rk(b)&&ra.rate_amount<rb.rate_amount)out.push({detail:`${a.role_type} ${a.pay} < ${b.role_type} ${b.pay}`});}));
  return out.slice(0,1);
});
check(7,"pay_line_vs_roles","Pay paragraph contradicts the role rates (weekly vs stipend, flat vs range)",L=>{
  const rp=L.roles.map(r=>r.pay).join(" ");
  if(/stipend for the run/i.test(rp)&&/\bweekly\b|a week\b|per week/i.test(L.pay)&&!/no weekly salary/i.test(L.pay))return[{detail:L.pay}];
  return[];
});
check(7,"stated_age","Age stated in the description contradicts the range or the playing age",L=>{
  const W={six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
  const out=[];
  L.roles.forEach(r=>{const d=String(r.description||"");const m=d.match(/(?:^|[.;—:]\s*)(Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty)\b(?: years old)?[,.]/)||d.match(/\b(six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d{1,2}) years old\b/i);
    if(!m)return;const v=W[m[1].toLowerCase()]||+m[1];const p=d.match(/To play (\d+)\./);
    if(v<minAge(r)||v>maxAge(r)||(p&&+p[1]!==v))out.push({detail:`${r.name} ${r.age_range} "${m[0].trim()}"${p?" "+p[0]:""}`});});
  return out;
});
check(7,"gendered_label","Male-coded part (fisherman, son…) cast female or the reverse",L=>{
  const M=/\b(son|father|husband|brother|uncle|nephew|grandfather|grandson|widower|boy|man|dad|groom|businessman|salesman|fisherman|doorman|repairman|foreman|policeman|fireman|handyman|watchman)\b/i,F=/\b(daughter|mother|wife|sister|aunt|niece|grandmother|granddaughter|widow|girl|woman|actress|waitress|bride|mom|hostess)\b/i;
  return L.roles.filter(r=>{const d=String(r.description||"").split(/[.:]/)[0];return (r.gender==="Female"&&M.test(d)&&!F.test(d))||(r.gender==="Male"&&F.test(d)&&!M.test(d));}).map(r=>({detail:`${r.name} ${r.gender}: ${String(r.description).split(/[.:]/)[0]}`}));
});
check(7,"silent_part_speaks","Speaking note on a silent part, or a no-talking note on a part that talks",L=>L.roles.filter(r=>(/to the lens|talk straight into the camera|down the barrel/i.test(r.description)&&/without dialogue|no dialogue|no lines|says nothing/i.test(r.description))||(/nobody in this spot talks|you do not speak|there are no lines for this part|no dialogue at all/i.test(r.description)&&/\b(advice|talks?|says|speaks|explains|asks|argues|chats)\b/i.test(sentences(r.description).filter(x=>!/nobody in this spot talks|you do not speak|no lines|no dialogue/i.test(x)).join(" ")))).map(r=>({detail:r.name+": "+r.description.slice(0,90)})));
check(7,"parent_age","Parent younger than 17 years older than the child in the cast",L=>{
  const raw=L._raw._roles||[];const kid=raw.filter(r=>/\b(child|kid|son|daughter|teen|teenager|student|youngest)\b/i.test(r._slot||""));
  if(!kid.length)return[];const km=Math.max(...kid.map(maxAge));
  return raw.filter(r=>/\b(parent|mother|father|mom|dad)\b/i.test(r._slot||"")&&!/\b(child|son|daughter)\b/i.test(r._slot||"")&&minAge(r)<km+17).map(r=>({detail:`${r.name} ${r.age_range} vs child up to ${km}`}));
});
check(7,"odd_caps","Stray capitals mid-sentence in the synopsis (\"for lighting Double for the Office\")",L=>{const m=String(L.synopsis).match(/\b[a-z]+ (?:Double|Background|Performer|Driver) for the [A-Z]/);return m?[{detail:m[0]}]:[];});
check(7,"era_now","\"It is set in the now\"",L=>/set in the (now|present|today)\b/i.test(L.synopsis)?[{detail:L.synopsis.slice(-60)}]:[]);
check(7,"twist_fragment","Twist sentence is a bare noun-phrase fragment",L=>{const s2=sentences(L.synopsis)[1]||"";return /^(One|A|An|The|Every|Each) [a-z ]+ (carried|shot|filmed|photographed|built|told|made|cast|set|played|done|seen|recorded|used) /.test(s2)&&!/\b(is|are|was|were|has|have|gets|runs|ends|starts|plays|turns|takes|comes|goes)\b/.test(s2)?[{detail:s2}]:[];});
check(7,"ad_run_length","How long the ad runs is stated two different ways",L=>{
  const t=allText(L);const set=new Set((t.match(/\b(six|twelve|nine|6|12|9)[- ]months?\b|\b(one|a) year\b|\btwelve-month\b|\bsix-month\b/gi)||[]).map(x=>/six|6/i.test(x)?6:/nine|9/i.test(x)?9:12));
  return set.size>1?[{detail:[...set].join(" vs ")+" months"}]:[];
});
check(5,"two_call_times","Schedule note gives two different call/start times",L=>{const n=String(L.schedule_note||"");const t=new Set(n.match(/\b\d{1,2}(:\d\d)?(am|pm)\b/gi)||[]);return (n.match(/starting at \d|\bcall is\b|\bcall\b/gi)||[]).length>1&&t.size>1?[{detail:n}]:[];});
check(6,"people_label_on_person","\"People at the …\" label on a non-background part",L=>L.roles.filter(r=>/^People at the /.test(r.name)&&!/background/i.test(r.role_type)).map(r=>({detail:r.name})));
check(7,"group_given_person","Plural/group role given a single person's name",L=>L.roles.filter(r=>!isGroup(r)&&/^(the )?(kids|crowd|regulars|neighbors|students|customers|dancers|patrons|riders|guests|ensemble|family members|shoppers|voices)\b/i.test(String(r.description||"").replace(/^[A-Z][a-z]+, /,"").replace(/^[A-Z][a-z]+ — /,""))).map(r=>({detail:r.name+": "+r.description.slice(0,60)})));
check(7,"family_mismatch","Parent/child/siblings with clashing name heritage",null);

// ── Round 2 checks (role logic, cross-field logic, names) ─────────────────
const srcNow=fs.readFileSync(path.join(__dirname,"..","..","swipecast-full.jsx"),"utf8");
const ctxNow={names:(()=>{
  // Familiar-name pools read from the CURRENT source, so a "before" run is
  // measured against the same pools as the "after" run.
  const m=srcNow.match(/const V4_NAME_DATA=(\{[\s\S]*?\n  \});/);
  if(!m)return null;
  const D=Function("return "+m[1])();
  const first={},last={};
  Object.entries(D.firstByEra).forEach(([g,eras])=>Object.entries(eras).forEach(([era,list])=>list.forEach(n=>{const e=D.eraYears[era];(first[n]=first[n]||{bg:"general",eras:[]}).eras.push(e);})));
  Object.entries(D.unisexByEra||{}).forEach(([era,list])=>list.forEach(n=>{(first[n]=first[n]||{bg:"general",eras:[]}).eras.push(D.eraYears[era]);}));
  // A heritage name that is also on a general era list keeps the general eras
  // (and reads as general); otherwise it spans 1950–2012 and is heritage.
  Object.entries(D.heritageFirst).forEach(([bg,gs])=>Object.values(gs).forEach(list=>list.forEach(n=>{if(!first[n])first[n]={bg,eras:[(D.heritageOld||[]).indexOf(n)>-1?[1950,2008]:[1970,2008]]};})));
  Object.entries(D.surnames).forEach(([bg,list])=>list.forEach(n=>{(last[n]=last[n]||[]).push(bg);}));
  return {first,last,famous:new Set((D.famous||[]).map(clean))};
})()};
require("./checks-r2.cjs")({check,addBoard:(fn,labels)=>{boardHooks.push(fn);labels.forEach(([k,l])=>check(8,k,l,null));},sentences,clean,minAge,maxAge,isGroup,famOf,srcNow,parseRoleRate,ctxNow});

// ── Board-level checks ──────────────────────────────────────────────────────
function boardChecks(){
  const r={};
  const add=(k,id,detail)=>{(r[k]=r[k]||[]).push({id,detail});};
  // repeated sentences
  const seen=new Map();
  listings.forEach(L=>{
    const parts=[...sentences(L.synopsis),L.tagline,...sentences(L.schedule_note),...L.roles.flatMap(x=>sentences(x.description))];
    new Set(parts.map(clean).filter(s=>s.split(" ").length>=6)).forEach(s=>{if(seen.has(s)&&seen.get(s)!==L.id)add("repeated_sentences",L.id,`"${s.slice(0,80)}" (also ${seen.get(s)})`);else seen.set(s,L.id);});
  });
  const closers=new Map();
  listings.forEach(L=>{const s=sentences(L.synopsis);if(s.length<2)return;const c=clean(s[s.length-1]).replace(/\b\d+\b/g,"#");if(closers.has(c))add("closing_repeats",L.id,`"${c.slice(0,70)}" (also ${closers.get(c)})`);else closers.set(c,L.id);});
  // opening skeleton
  const skel=L=>{const s1=sentences(L.synopsis)[0]||"";let x=s1.replace(TYPE_WORDS[L.type]||/$^/,"TYPE");return x.split(/\s+/).slice(0,4).map(w=>/^(a|an|the|this|in|about|we|our|it|is|are|TYPE|set|for|on|at|with|when|what|how|who|here|there|story|follows|film|series)$/i.test(w.replace(/[^\w]/g,""))?w.toLowerCase():"_").join(" ");};
  const sk={};listings.forEach(L=>{const k=skel(L);(sk[k]=sk[k]||[]).push(L.id);});
  Object.entries(sk).forEach(([k,ids])=>{if(ids.length>listings.length*0.10)ids.slice(Math.floor(listings.length*0.10)).forEach(id=>add("opening_skeleton",id,`skeleton "${k}" used ${ids.length}x`));});
  for(let i=1;i<listings.length;i++){const a=clean(listings[i-1].synopsis).split(" ").slice(0,4).join(" "),b=clean(listings[i].synopsis).split(" ").slice(0,4).join(" ");if(a===b)add("opening_skeleton",listings[i].id,`adjacent same first 4 words "${a}"`);}
  // similar stories: shared content words
  // The story is sentences one and two; the casting and detail sentences are shared scaffolding.
  const terms=L=>new Set(clean(sentences(L.synopsis).slice(0,2).join(" ")).split(" ").filter(w=>w.length>4&&!/^(about|where|which|makes|different|there|campaign|series|project|video|shows?|built|around|whole|photographed|subject|subjects|people|every|person)$/.test(w)));
  for(let i=0;i<listings.length;i++)for(let j=0;j<i;j++){const a=terms(listings[i]),b=terms(listings[j]);const inter=[...a].filter(w=>b.has(w)).length;const u=Math.min(a.size,b.size);if(u>=8&&inter/u>=0.5){add("similar_story",listings[i].id,`~${listings[j].id} (${inter}/${u})`);break;}}
  // voices
  const voices={};listings.forEach(L=>{const v=L._raw._voiceKey||"(none)";voices[v]=(voices[v]||0)+1;});
  Object.entries(voices).forEach(([v,n])=>{if(v==="(none)"||n>listings.length*0.25)add("voice_spread","board",`${v}: ${n}`);});
  // type spread
  const tc={};listings.forEach(L=>tc[L.type]=(tc[L.type]||0)+1);
  const usable=PROJECT_TYPE_OPTIONS.filter(t=>t!=="Other");
  const missing=usable.filter(t=>!tc[t]);const maxT=Math.max(...Object.values(tc));
  const expect=listings.length/usable.length;
  if(missing.length>Math.max(0,usable.length-listings.length))add("type_spread","board",`${missing.length} types never drawn: ${missing.join(", ")}`);
  Object.entries(tc).forEach(([t,n])=>{if(n>Math.ceil(expect)+2)add("type_spread","board",`${t} ${n}x (expected ~${expect.toFixed(1)})`);});
  // NYC share
  const nyc=listings.filter(L=>/New York, NY/.test(L.location)).length;
  const share=nyc/listings.length;
  if(share>0.70||share<0.50)add("nyc_share","board",`${nyc}/${listings.length} = ${(share*100).toFixed(0)}%`);
  r._nyc=`${nyc}/${listings.length} (${(share*100).toFixed(0)}%)`;
  // areas
  // "Venue, Area (City)" or "Area (City)"; the area is whichever of the city's pool entries the location ends with.
const areaOf=L=>{const loc=String(L.shoot_location||"").replace(/\s*\([^()]*\)\s*$/,"");const pool=(CITIES.find(c=>c.name===L.location)||{}).areas||[];const hit=pool.filter(a=>loc===a||loc.endsWith(", "+a)||loc.endsWith(" in "+a)).sort((a,b)=>b.length-a.length)[0];return hit||loc;};
  const byCity={};const areaCount={};
  listings.forEach(L=>{
    const city=L.location;const a=areaOf(L);const key=city+"|"+a;areaCount[key]=(areaCount[key]||0)+1;
    const pool=(CITIES.find(c=>c.name===city)||{}).areas||[];
    const used=(byCity[city]=byCity[city]||[]);
    const sinceReset=used.slice(used.length-(used.length%Math.max(1,pool.length)));
    if(pool.length&&used.includes(a)&&new Set(used).size<pool.length)add("area_repeat_early",L.id,`${a} again (${new Set(used).size}/${pool.length} used)`);
    used.push(a);
  });
  const top=Object.entries(areaCount).sort((a,b)=>b[1]-a[1])[0]||["",0];
  r._areaMax=`${top[0]} ×${top[1]}`;
  if(top[1]>2)add("area_max","board",`${top[0]} ×${top[1]}`);
  // schedule notes
  const sn=new Map();const sns=new Map();
  listings.forEach(L=>{const k=clean(L.schedule_note);if(sn.has(k))add("sched_note_repeat",L.id,`whole note = ${sn.get(k)}`);else sn.set(k,L.id);
    sentences(L.schedule_note).forEach(s=>{const c=clean(s).replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b/g,"#");if(c.split(" ").length<4)return;if(sns.has(c)&&sns.get(c)!==L.id)add("sched_note_repeat",L.id,`"${c.slice(0,70)}" = ${sns.get(c)}`);else sns.set(c,L.id);});});
  // names
  const chars=new Map(),crew=new Map(),surnames={};
  // Relatives share a surname on purpose (round 2), so a family counts once.
  const famOfRole=(L,name)=>{const raw=(L._raw._roles||[]).find(x=>x.name===name);return raw&&raw._familyId||null;};
  const people=L=>L.roles.filter(r=>!isGroup(r)).map(r=>({n:r.name,k:"char",fam:famOfRole(L,r.name)})).concat((L._raw._crewNames||[]).map(n=>({n,k:"crew",fam:null})));
  listings.forEach(L=>{
    people(L).forEach(p=>{
      const m=p.k==="char"?chars:crew;const other=p.k==="char"?crew:chars;
      if(m.has(p.n))add(p.k==="char"?"char_name_repeat":"crew_name_repeat",L.id,`${p.n} (also ${m.get(p.n)})`);else m.set(p.n,L.id);
      if(p.k==="crew"&&other.has(p.n))add("crew_name_repeat",L.id,`${p.n} is also a character in ${other.get(p.n)}`);
    });
    new Set(people(L).map(p=>p.n.split(" ").pop())).forEach(s=>{surnames[s]=(surnames[s]||0)+1;});
  });
  // Round 2 replaced "never 3+ times" with a 50-project cooldown, so this now
  // flags a surname used 3+ times inside any 50-listing window.
  const lastIdx={};listings.forEach((L,i)=>new Set(people(L).map(p=>p.n.split(" ").pop())).forEach(s=>{(lastIdx[s]=lastIdx[s]||[]).push(i);}));
  Object.entries(lastIdx).forEach(([s,ix])=>{for(let k=2;k<ix.length;k++)if(ix[k]-ix[k-2]<50){add("surname_3plus","board",`${s} ×3 within 50 listings`);break;}});
  let prev=null;
  listings.forEach(L=>{
    const pl=people(L);const sn=pl.map(p=>p.n.split(" ").pop());
    const dup=sn.find((s,i)=>{const j=sn.indexOf(s);return j!==i&&!(pl[i].fam&&pl[i].fam===pl[j].fam);});
    if(dup)add("surname_same_listing",L.id,`${dup} twice in listing`);
    if(prev){const ps=new Set(people(prev).map(p=>p.n.split(" ").pop()));const hit=sn.find(s=>ps.has(s));if(hit)add("surname_same_listing",L.id,`${hit} also in adjacent ${prev.id}`);}
    prev=L;
  });
  // company cores
  const TAIL=/\b(capture studios|interactive|film company|motion pictures|television|entertainment|theater company|stage company|theater project|repertory|commercial productions|photo studio|studios|photography|events|experiences|live|movement lab|dance company|animation|games|content|pictures|films?|productions?|creative studio|content lab|theatre lab|theatre company|theater company|stage company|new works|motion|workshop collective|capstone unit|media works|independent pictures|commercial unit|cinema|story lab|film group|development lab|project studio|advertising works|brand studio|studio|photography studio|image lab|casting studio|playhouse|theatre project|picture company|features|pictures co|creative|media|agency|collective|audio|sound|works|house|company|co)\b/gi;
  const core=L=>clean(String(L.prod||"").split(" — ")[0].replace(/^.* Casting for /,"").replace(TAIL,"").replace(/^(NYC|LA|Chicago|Boston|Philly|Atlanta|Newark|New Orleans|Pittsburgh|Austin|Detroit|Baltimore|North|South|East|West|Lower|Upper|Downtown|Uptown) /,""));
  const cores=new Map();
  listings.forEach(L=>{const c=core(L);if(!c)return;if(cores.has(c))add("company_core_repeat",L.id,`"${c}" (also ${cores.get(c)})`);else cores.set(c,L.id);});
  // family heritage
  listings.forEach(L=>{
    const fam=L.roles.filter(r=>!isGroup(r)&&/\b(father|mother|dad|mom|son|daughter|brother|sister|grand(mother|father|son|daughter)|twin)\b/i.test(String(L._raw._roles&&L._raw._roles.find(x=>x.name===r.name)&&L._raw._roles.find(x=>x.name===r.name)._slot||"")));
    const eth=new Set(fam.map(r=>r.ethnicity).filter(e=>e&&!/any|mixed/i.test(e)));
    if(fam.length>=2&&eth.size>1)add("family_mismatch",L.id,fam.map(r=>`${r.name} (${r.ethnicity})`).join(" / "));
  });
  boardHooks.forEach(fn=>{const extra=fn(listings,add);Object.assign(r,{_names:extra});});
  return r;
}

// ── Run ─────────────────────────────────────────────────────────────────────
const board=boardChecks();
const results=checks.map(c=>{
  let fails=[];
  if(c.fn&&c.once){let f=[];try{f=c.fn()||[];}catch(e){f=[{detail:"CHECK ERROR "+e.message}];}f.forEach(x=>fails.push({id:"board",detail:x.detail}));}
  else if(c.fn)listings.forEach(L=>{let f=[];try{f=c.fn(L)||[];}catch(e){f=[{detail:"CHECK ERROR "+e.message}];}f.forEach(x=>fails.push({id:L.id,detail:x.detail}));});
  else fails=board[c.key]||[];
  const listingsHit=new Set(fails.map(f=>f.id).filter(id=>id!=="board")).size;
  return{step:c.step,key:c.key,label:c.label,listings:listingsHit,issues:fails.length,examples:fails.slice(0,4)};
});

const pad=(s,n)=>String(s).padEnd(n);
console.log(`\nACG harness — ${listings.length} listings in ${(ms/1000).toFixed(1)}s (${SAME_BROWSER?"same browser":"localStorage wiped between batches"})`);
console.log(`NYC share: ${board._nyc}   most-used neighborhood: ${board._areaMax}`);
const tc={};listings.forEach(L=>tc[L.type]=(tc[L.type]||0)+1);
console.log(`Types drawn: ${Object.keys(tc).length}/${PROJECT_TYPE_OPTIONS.length-1}   max per type: ${Math.max(...Object.values(tc))}`);
let lastStep=0;
results.forEach(r=>{
  if(r.step!==lastStep){console.log(`\n STEP ${r.step}`);lastStep=r.step;}
  console.log(`  ${r.issues?"✗":"✓"} ${pad(r.key,24)} listings:${pad(r.listings,4)} issues:${pad(r.issues,4)} ${r.label}`);
  if(r.issues&&!args.includes("--quiet"))r.examples.forEach(e=>console.log(`       · ${e.id}: ${String(e.detail).slice(0,150)}`));
});
if(board._names){const N=board._names;console.log(`Names: ${N.namesTotal} people · familiar ${N.familiarPct==null?"n/a (no V4 pools in source)":N.familiarPct+"%"} · background mix ${JSON.stringify(N.backgrounds)}`);if(args.includes("--names"))console.log("Sample names:\n  "+N.sampleNames.join("\n  "));}
const firstOk=listings.length-(results.find(r=>r.key==="first_sentence").listings);
console.log(`\nFirst sentence says what the project is: ${firstOk}/${listings.length}`);
const failing=results.filter(r=>r.issues);
if(args.includes("--why"))console.log("Rejections by reason (last 40 per batch):",JSON.stringify(Object.entries(WHY).sort((a,b)=>b[1]-a[1]).slice(0,25)),`attempts ${ATTEMPTS}, rejected ${REJECTED}`);
console.log(`Checks passing: ${results.length-failing.length}/${results.length}\n`);
if(JSON_OUT)fs.writeFileSync(JSON_OUT,JSON.stringify({n:listings.length,ms,nyc:board._nyc,areaMax:board._areaMax,types:tc,names:board._names,results},null,1));
if(SAMPLES_OUT){
  const fmt=L=>[`══ ${L.title}  [${L.type}]`,`Posted by: ${L.prod}   Casting director: ${L.casting_director_name}`,`Tagline: ${L.tagline}`,`Location: ${L.location}   Shoot location: ${L.shoot_location}`,`Union: ${L.union_status}   Deadline: ${L.deadline}   Shoot: ${L.shoot_start} → ${L.shoot_end}`,`Schedule: ${L.schedule_note}`,``,L.synopsis,``,`Pay: ${L.pay}`,`Submit: ${L.submission_requirements}`,``,...L.roles.map(r=>`  • ${r.name} — ${r.role_type}, ${r.gender}, ${r.age_range}, ${r.ethnicity}, ${r.pay}, ${r.est_days} day(s)\n    ${r.description}`),``].join("\n");
  fs.writeFileSync(SAMPLES_OUT,listings.map(fmt).join("\n"));
}
process.exitCode=failing.length?1:0;
