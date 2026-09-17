// Round 2 checks (2026-09-16): role logic, cross-field logic and names.
// Registered by run.cjs. Every rule here is also enforced by the generator's
// validator (v3Problems / v4RoleProblems) — this file is the independent test.
module.exports=function register({check,addBoard,sentences,clean,minAge,maxAge,isGroup,famOf,srcNow,parseRoleRate,ctxNow}){
  const ageRange=r=>[minAge(r),maxAge(r)];
  const slotOf=(L,r)=>{const raw=(L._raw._roles||[]).find(x=>x.name===r.name);return String((raw&&raw._slot)||"");};
  const CHILD=/\b(son|daughter|child|kid|boy|girl|grandson|granddaughter|grandchild|stepson|stepdaughter|sibling|brother|sister)\b/i;
  const PARENT=/\b(mother|father|mom|dad|parent|stepmother|stepfather)\b/i;
  const GRAND=/\bgrand(mother|father|parent|ma|pa)\b/i;

  // 1. Family and implied-age logic.
  check(8,"family_age_gap","Parent/grandparent not ≥18/36 years older than the child at every point of both ranges; 'N years' older than the age allows",L=>{
    const out=[];const roles=L.roles.filter(r=>!isGroup(r));
    const kids=roles.filter(r=>CHILD.test(slotOf(L,r))&&!PARENT.test(slotOf(L,r).replace(CHILD,"")));
    const parents=roles.filter(r=>PARENT.test(slotOf(L,r))&&!CHILD.test(slotOf(L,r))&&!GRAND.test(slotOf(L,r)));
    const grands=roles.filter(r=>GRAND.test(slotOf(L,r)));
    kids.forEach(k=>{
      const [,khi]=ageRange(k);
      parents.forEach(p=>{const [plo]=ageRange(p);if(plo-khi<18)out.push({detail:`${p.name} (${slotOf(L,p)}) ${p.age_range} vs ${k.name} (${slotOf(L,k)}) ${k.age_range}`});});
      grands.forEach(g=>{const [glo]=ageRange(g);if(glo-khi<36&&!/grand/i.test(slotOf(L,k)))out.push({detail:`grand ${g.age_range} vs ${k.age_range}`});});
      // "her son" / "his daughter": the parent is the named role of that gender the label points at.
      const m=slotOf(L,k).match(/\b(her|his)\s+(son|daughter|child|kid)/i);
      if(m){const g=m[1].toLowerCase()==="her"?"Female":"Male";const p=roles.find(x=>x!==k&&x.gender===g&&/lead/i.test(x.role_type));if(p&&minAge(p)-khi<18)out.push({detail:`"${m[0]}" ${k.age_range} vs ${p.name} ${p.age_range}`});}
    });
    L.roles.forEach(r=>{const d=String(r.description||"");const y=d.match(/\b(\d+|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?)\s+years\b(?! old| from| ago| later| younger| older| apart| earlier| before| after)/i);
      if(y){const U={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50};const t=y[1].toLowerCase();const n=/^\d+$/.test(t)?+t:t.split("-").reduce((a,x)=>a+(U[x]||0),0);if(n+18>minAge(r))out.push({detail:`${r.name} ${r.age_range}: "${y[0]}"`});}
      if(/\bveteran\b|\bretired\b|\bdecades\b/i.test(d)&&minAge(r)<35)out.push({detail:`${r.name} ${r.age_range}: veteran/retired`});});
    return out;
  });

  // 2. Every role must exist in the story.
  const STORY_NOUNS="report address shop store coat jacket suit bag box envelope letter note tape recording money cash check debt loan painting ring key keys car van truck bike boat phone gun knife body file files list contract deal sale vote election meeting contest race fight crash fire flood storm accident robbery trial case house apartment building school hospital church bar restaurant diner kitchen office warehouse garage station gym farm lake river bridge road block neighborhood town company business plant factory camp court jail prison lawyer doctor landlord husband wife son daughter mother father brother sister baby dog cat package delivery photo photograph picture video diary will inheritance secret affair test exam audition interview wedding funeral party trip hotel motel bus train plane ferry map ticket lottery prize award grant scholarship tournament match game season team band choir show concert recital store boss owner partner uncle aunt grandmother grandfather cousin nephew niece girlfriend boyfriend fiance ex".split(" ");
  const POLICE=/\b(police|officer|detective|cop|cops|sheriff|deputy|patrol)\b/i;
  const POLICE_WHY=/\b(police|officer|detective|cop|sheriff|deputy|crime|robbery|rob|theft|stolen|steal|missing|murder|body|dead|death|investigat|arrest|court|prison|evidence|case|report|accident|crash|break-in|burglar|fraud|scam|smuggl|drug|gun|attack|assault|kidnap|hostage|precinct|patrol)\b/i;
  function storyHay(L){
    const raw=L._raw._roles||[];
    return clean([L.title,L.tagline,L.synopsis,L.shoot_location,...raw.map(r=>`${r._slot||""} ${r.name||""}`)].join(" "));
  }
  const stem=w=>w.replace(/(ies)$/,"y").replace(/(es|s)$/,"").slice(0,6);
  check(8,"role_story_reference","A role refers to a person, object, event or place the synopsis never sets up (or police with no reason)",L=>{
    const out=[];const hay=storyHay(L);const hayStems=new Set(hay.split(" ").map(stem));
    L.roles.forEach(r=>{
      const d=String(r.description||"");
      (d.match(/\b(the|that|this|those|these|his|her|their)\s+([a-z]+)/gi)||[]).forEach(m=>{
        const w=m.split(/\s+/)[1].toLowerCase();
        if(STORY_NOUNS.indexOf(w)>-1&&!hayStems.has(stem(w)))out.push({detail:`${r.name}: "${m}" not in the story`});
      });
      if(/\b(open|find|hide|return|deliver|keep|sell|read|burn|steal)\s+it\b/i.test(d)&&!/\b(something|coat|package|envelope|box|bag|letter|note|tape|money|ring|key|painting|file|diary|phone|map|ticket)\b/i.test(hay))out.push({detail:`${r.name}: "it" with no object in the story`});
      if(POLICE.test(`${slotOf(L,r)} ${d}`)&&!POLICE_WHY.test(`${sentences(L.synopsis).slice(0,2).join(" ")} ${L.tagline}`))out.push({detail:`${r.name}: police with no reason in the synopsis`});
    });
    return out.slice(0,3);
  });

  // 3. No duplicate role functions.
  const FUNCS=/\b(officer|cop|detective|manager|driver|nurse|doctor|lawyer|waiter|waitress|bartender|guard|clerk|receptionist|customer|teacher|coach|agent|dispatcher|supervisor|owner|chef|cook|host|reporter|pastor|priest|judge|inspector)\b/i;
  check(8,"duplicate_role_function","Two roles with the same job and no clear difference",L=>{
    const out=[];const seen={};
    L.roles.filter(r=>!isGroup(r)).forEach(r=>{const s=slotOf(L,r).toLowerCase();const m=s.replace(/\b\w+['’]s\b/g,"").match(FUNCS);if(!m)return;let k=m[1];if(/cop|officer|detective|deputy/.test(k))k="police";
      if(seen[k]&&stripQual(seen[k])===stripQual(s))out.push({detail:`"${seen[k]}" and "${s}"`});else if(seen[k]&&!/\b(first|second|third|new|old|older|younger|rival|other|head|night|day|senior|junior|regular|last|co)\b/.test(s+" "+seen[k]))out.push({detail:`"${seen[k]}" and "${s}"`});seen[k]=s;});
    return out;
  });
  const stripQual=s=>s.replace(/^(the|a|an)\s+/,"");

  // 4. Scene counts inside one role.
  const SC={"one scene":1,"a single scene":1,"single scene":1,"two scenes":2,"two or three scenes":2.5,"three scenes":3,"a handful of scenes":4,"few scenes":3,"four scenes":4};
  check(8,"scene_count_conflict","A role states two different scene counts, or 'one scene' with several shoot days",L=>{
    const out=[];
    L.roles.forEach(r=>{const d=String(r.description||"").toLowerCase();const found=new Set();Object.keys(SC).forEach(k=>{if(new RegExp("\\b"+k+"\\b").test(d))found.add(SC[k]);});
      if(found.has(2.5)){found.delete(2);found.delete(3);}
      if(found.size>1)out.push({detail:`${r.name}: ${[...found].join(" vs ")} scenes`});
      if(found.has(1)&&+r.est_days>2&&famOf(L.type)!=="stage")out.push({detail:`${r.name}: one scene over ${r.est_days} days`});});
    return out;
  });

  // 5. Name / function first, possessives by name.
  check(8,"role_name_first","Description doesn't open with the character's name and who they are, or uses 'her son' instead of the name",L=>{
    const out=[];
    L.roles.forEach(r=>{const d=String(r.description||"");const first=String(r.name).split(" ")[0];
      if(!isGroup(r)&&!new RegExp("^"+first.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(,| is | —)").test(d))out.push({detail:`${r.name}: ${d.slice(0,60)}`});
      if(/^(Looking for someone to play|Plays |That is)|\bThat is (the|a|an)\b/.test(d))out.push({detail:`${r.name}: ${d.slice(0,60)}`});
      if(/^[^.]*\b(her|his|their)\s+(son|daughter|mother|father|wife|husband|brother|sister|boss|partner)\b/i.test(d))out.push({detail:`${r.name}: possessive instead of a name: ${d.slice(0,70)}`});});
    return out;
  });

  // 6. Pronouns.
  check(8,"pronoun_they_gendered","'they/them/their' on a Male or Female role (only All genders / Non-binary use they)",L=>L.roles.filter(r=>/^(Male|Female)$/.test(r.gender)&&!isGroup(r)&&/\b(they|them|their|theirs|themselves)\b/i.test(r.description)).map(r=>({detail:`${r.name} ${r.gender}: ${(r.description.match(/[^.]*\b(they|them|their|theirs|themselves)\b[^.]*\./i)||[""])[0].slice(0,80)}`})));

  // 7. Filler add-on lines.
  const FILLER=/room to make things up|needs real weight|behaves differently around them|a fitting beforehand|ideally a local hire|one or two calls, close together|every scene (they have|he has|she has) is against|shares the bulk of|most of (their|his|her) scenes are|plays opposite|scenes with [A-Z]|should feel like they had a life|play the day around it|expect notes|turn on a note|chemistry read|paired at (the )?callback|bring an idea|come in with a choice|play it small|keep it quiet|do not push it|no need to push|keep it real|play it straight|anything bigger fights|the writing carries|holds pressure|under strain for a long time|turns on a dime|changes twice in one scene|changes on a single line|long stretches with no lines|whole scenes on listening|much of this part is reacting|funny helps here|the humor is dry|comic timing matters|there is real physical work|the body does a lot|plenty of moving around|there is rehearsal on this|we rehearse before we shoot|expect rehearsal time|the whole part turns on one scene|one scene decides this role|we are casting this on a single scene|no accent needed|play it in your own voice|use your own accent|presence matters more|casting for authority|this one is mostly listening|built out of reactions|while someone else talks|age is a guide|read the age range loosely|flexible on the age|we work fast|direction comes in small pieces|\bfew scenes,|not a big part|a handful of scenes,|good with interruptions|comfortable talking over|able to talk over|local hire preferred|local casting for this part|some improvising likely|play with this in rehearsal|anchors one sequence|owns a single scene|runs one whole scene|needs a life outside this|has somewhere to be afterwards|handles props through|lots of business with the hands|works close to the crew|one hard beat|one difficult moment|a single sharp turn|could be any gender|open on gender for this one|without a fixed gender|needs one wardrobe call|there is a separate fitting|written very specific|close to the bone|a real person in this writing/i;
  check(8,"filler_lines","Generic add-on lines that aren't about this character",L=>L.roles.filter(r=>FILLER.test(r.description)).map(r=>({detail:`${r.name}: "${(r.description.match(FILLER)||[""])[0]}"`})));

  check(8,"cutoff_or_group_line","Role sentence cut off ('…a side, until.') or a 'few of you' line on a single part",L=>L.roles.filter(r=>sentences(r.description).some(z=>/\b(until|and|but|or|because|the|a|an|of)\.$/i.test(z))||(!isGroup(r)&&/\b(a few of you|one of the people in the room|you fill the world)\b/i.test(r.description))).map(r=>({detail:`${r.name}: ${r.description.slice(0,90)}`})));

  check(8,"lowercase_sentence","A role or synopsis sentence starts with a lowercase letter",L=>[L.synopsis,...L.roles.map(r=>r.description)].filter(t=>/(^|[.!?]\s+)[a-z]/.test(String(t||"").replace(/\b(e\.g|i\.e)\./g,""))).map(t=>({detail:String(t).match(/(^|[.!?]\s+)[a-z][^.]{0,40}/)[0]})));
  check(8,"same_character_two_genders","The same character at two ages cast as different genders or names",L=>{const raw=L._raw._roles||[];const grown=raw.find(r=>/\b(same person|same character|older self|younger self|as an adult|grown up)\b/i.test(r._slot||""));return grown?[{detail:grown._slot}]:[];});

  check(8,"gendered_campaign","A men's/women's campaign casts the other gender in the customer parts",L=>{const m=/\bmen's\b/i.test(`${L.title} ${L.synopsis}`)?"Female":/\bwomen's\b/i.test(`${L.title} ${L.synopsis}`)?"Male":"";if(!m)return[];return (L._raw._roles||[]).filter(r=>!r._group&&r.gender===m&&!/\b(barber|staff|apprentice|clerk|associate|attendant|doctor|nurse|host)\b/i.test(r._slot||"")).map(r=>({detail:`${r.name} ${r.gender}: ${r._slot}`}));});

  // 8. Placeholder leaks.
  check(8,"placeholder_leak","Untitled/Working Title titles, (Group N), Group A, 1) labels",L=>{
    const out=[];
    if(/^Untitled\b|\((Working Title|Part One|Season One|New Pages|Revised|Take Two|Chapter One|Second Draft|Blue Pages|Pink Pages|Reshoot|Winter Draft)\)/i.test(L.title))out.push({detail:L.title});
    L.roles.forEach(r=>{if(/\(Group|\bGroup [A-Z0-9]\b|(^|\s)\d\)|(^|\s)[A-Z]\)/.test(r.name))out.push({detail:r.name});});
    return out;
  });

  // 9. Ethnicity only when the story needs it, and then explained.
  check(8,"ethnicity_unexplained","A specific ethnicity on a role whose description gives no story reason",L=>L.roles.filter(r=>r.ethnicity&&!/^any/i.test(r.ethnicity)&&!/\b(heritage|family from|immigrant|grew up in|speaks|language|culture|community|background|born in|first-generation|mixed-race|biracial)\b/i.test(r.description)).map(r=>({detail:`${r.name}: ${r.ethnicity}`})));

  // 10. Submission requirements built from the roles.
  check(8,"submission_vs_roles","Listing asks for things no role requires (reel, self-tape, voice) or says 'union status required' on Non-Union",L=>{
    const out=[];const s=String(L.submission_requirements||"");
    const anyReel=L.roles.some(r=>(r.required_media||[]).includes("reel")),anySelf=L.roles.some(r=>r.prescreen==="selftape"),anyVoice=L.roles.some(r=>r.prescreen==="voice"),anyResume=L.roles.some(r=>(r.required_media||[]).includes("resume")),anyFull=L.roles.some(r=>(r.required_media||[]).includes("fullbody"));
    if(/self-tape|selftape/i.test(s)&&!anySelf)out.push({detail:"self-tape asked, no role has a self-tape first look"});
    if(/\breel\b|recent footage|shot recently|demo/i.test(s)&&!anyReel)out.push({detail:"reel asked, no role requires a reel"});
    if(/voice memo|voice sample|reading any two lines|thirty seconds of you reading/i.test(s)&&!anyVoice)out.push({detail:"voice sample asked, no voice first look"});
    if(/résumé|resume|\bCV\b|credit list/i.test(s)&&!anyResume)out.push({detail:"résumé asked, no role requires one"});
    if(/full-body|full-length|full body/i.test(s)&&!anyFull)out.push({detail:"full-body asked, no role requires one"});
    if(/union status|union standing/i.test(s)&&/non-union/i.test(L.union_status))out.push({detail:"union status on Non-Union"});
    return out;
  });

  // 13. Crew credits in their own field.
  check(8,"credits_field","Crew credits stuffed into the company or submission text instead of their own field",L=>{
    const out=[];
    if(/Credits:/.test(L.submission_requirements||""))out.push({detail:"credits in submission requirements"});
    if(!String(L.crew_credits||"").trim())out.push({detail:"crew_credits empty"});
    if(/ — | · |Prod\.|Dir\./.test(L.prod||"")||/^(NYC|LA|Chicago|Boston|Philly|Atlanta)\s/.test(L.prod||""))out.push({detail:L.prod});
    return out;
  });

  // 14. Verification badge.
  check(8,"badge_default","Generated listing not defaulted to No Badge",L=>L.admin_verified===null?[]:[{detail:String(L.admin_verified)}]);

  // 15. Schedule wording.
  check(8,"schedule_wording","Schedule note uses 'the one neighborhood' / contradicts itself",L=>/one neighborhood|one or two days move|stays in the one/i.test(L.schedule_note||"")?[{detail:L.schedule_note}]:[]);

  // 11. Top-rate chip helper (UI code outside ACG).
  check(8,"top_rate_chip","Top-rate chip shows a multi-day total instead of the top per-day rate",()=>{
    const m=srcNow.match(/function roleTopRate\(roles\)\{[\s\S]*?\n\}/);
    if(!m)return[{detail:"roleTopRate() missing — chip still uses the role total"}];
    const fn=Function(m[0]+";return roleTopRate;")();
    const r=fn([{rate_amount:175,rate_unit:"day",est_days:3},{rate_amount:150,rate_unit:"day",est_days:2}]);
    return r&&r.amount===175&&r.unit==="day"?[]:[{detail:JSON.stringify(r)}];
  },{once:true});

  // ── Names ────────────────────────────────────────────────────────────────
  const pools=ctxNow&&ctxNow.names;
  addBoard((listings,add)=>{
    const people=L=>L.roles.filter(r=>!isGroup(r)).map(r=>({n:r.name,age:[minAge(r),maxAge(r)],slot:slotOf(L,r),kind:"char"})).concat((L._raw._crewNames||[]).map(n=>({n,age:null,slot:"crew",kind:"crew"})));
    const firstOf=n=>String(n).split(" ")[0],lastOf=n=>String(n).split(" ").slice(1).join(" ").replace(/^[A-Z]\.\s+/,"");
    const recentF=[],recentL=[];
    const full=new Map();
    let total=0,familiar=0;const bg={};const samples=[];
    listings.forEach((L,idx)=>{
      const ps=people(L);
      const fs=ps.map(p=>firstOf(p.n)),ls=ps.map(p=>lastOf(p.n));
      fs.forEach((f,i)=>{if(fs.indexOf(f)!==i)add("name_first_dup_listing",L.id,`${f} twice`);});
      ls.forEach((l,i)=>{const j=ls.indexOf(l);if(j!==i){const raw=L._raw._roles||[];const fi=(raw.find(x=>x.name===ps[i].n)||{})._familyId,fj=(raw.find(x=>x.name===ps[j].n)||{})._familyId;const fam=/\b(son|daughter|mother|father|mom|dad|brother|sister|wife|husband|grand|twin|cousin|uncle|aunt|parent|child|kid)\b/i;if(!(fi&&fi===fj)&&!(fam.test(ps[i].slot)&&fam.test(ps[j].slot)))add("name_last_dup_listing",L.id,`${l} twice (${ps[j].slot} / ${ps[i].slot})`);}});
      ps.forEach(p=>{
        const key=clean(p.n);if(full.has(key))add("name_full_repeat",L.id,`${p.n} (also ${full.get(key)})`);else full.set(key,L.id);
        const f=firstOf(p.n),l=lastOf(p.n);
        const win=recentF.slice(-50);
        if(win.some(set=>set.has(f)))add("name_first_cooldown",L.id,`${f} within 50 projects`);
        if(recentL.slice(-50).some(set=>set.has(l)))add("name_last_cooldown",L.id,`${l} within 50 projects`);
        total++;
        if(pools){
          const fe=pools.first[f],le=pools.last[l];
          if(fe&&le)familiar++;else add("name_unfamiliar",L.id,`${p.n}${fe?"":" (first)"}${le?"":" (last)"}`);
          if(le)bg[le[0]]=(bg[le[0]]||0)+1;
          if(fe&&le&&fe.bg!=="general"&&le.indexOf(fe.bg)<0&&!(fe.bg==="hispanic"&&le.indexOf("seasian")>-1))add("name_mashup",L.id,`${p.n}: ${fe.bg} first + ${le.join("/")} surname`);
          if(fe&&p.age&&isFinite(p.age[0])){const mid=(p.age[0]+p.age[1])/2;const born=2026-mid;if(!fe.eras.some(e=>born>=e[0]-8&&born<=e[1]+8))add("name_age_mismatch",L.id,`${p.n} age ${p.age.join("-")}, name era ${fe.eras.map(e=>e.join("-")).join(",")}`);}
          if(pools.famous.has(clean(p.n)))add("name_celebrity",L.id,p.n);
        }
        if(samples.length<40&&(idx%3===0))samples.push(`${p.n} (${p.kind==="crew"?"crew":p.slot}${p.age&&isFinite(p.age[0])?", "+p.age.join("-"):""})`);
      });
      recentF.push(new Set(fs));recentL.push(new Set(ls));
    });
    return {namesTotal:total,familiarPct:pools?Math.round(familiar*1000/Math.max(1,total))/10:null,backgrounds:bg,sampleNames:samples};
  },[["name_full_repeat","Full name (character or crew) used twice"],["name_first_dup_listing","Two people with the same first name in one listing"],["name_last_dup_listing","Two people with the same surname in one listing (not family)"],["name_first_cooldown","First name reused within 50 projects"],["name_last_cooldown","Surname reused within 50 projects"],["name_unfamiliar","Name not from the familiar U.S. pools"],["name_mashup","Heritage first name paired with an unrelated surname"],["name_age_mismatch","First name doesn't fit the role's age"],["name_celebrity","Celebrity name"]]);
};
