// Round 3 checks (2026-09-17): realistic variety in pay, dates, shoot length,
// synopsis length, schedule notes and cast size, plus the logic faults found
// in a live draft (pitch trailer, Savannah GA, retiring bus driver).
// Registered by run.cjs. Written independently of the generator's validator
// (v5Problems) — the two must agree, but neither is derived from the other.
module.exports=function register({check,addBoard,sentences,clean,famOf,parseRoleRate}){
  const DAY=86400000;
  const d=s=>new Date(String(s).slice(0,10)+"T12:00:00Z");
  const W={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
  const rankOf=r=>{const t=String(r.role_type||"");return /^(Lead|Principal|Principal Voice)$/i.test(t)?0:/background|ensemble/i.test(t)?3:/day player|featured/i.test(t)?2:1;};
  const plan=L=>(L._raw._v5&&L._raw._v5.plan)||{};
  const days=L=>plan(L).days||L._raw._shootDays||1;
  const isStage=L=>famOf(L.type)==="stage";
  const perDay=x=>!x?0:x.rate_unit==="hour"?x.rate_amount*8:x.rate_amount;
  const HOLIDAY=x=>{const m=x.getUTCMonth(),day=x.getUTCDate(),y=x.getUTCFullYear();if(m===6&&day>=3&&day<=5)return true;if((m===11&&day>=24)||(m===0&&day<=1))return true;if(m===10){const f=new Date(Date.UTC(y,10,1,12)).getUTCDay();const thu=1+((4-f+7)%7)+21;if(day>=thu-1&&day<=thu+1)return true;}return false;};
  const FILM_TYPES=/^(Feature Film|Short Film|Student Film|Independent Film|Experimental Film|Documentary|Background \/ Extras|Stand-In|Body Double|Stunts)$/;

  // ── Part A: logic ─────────────────────────────────────────────────────────
  check(9,"r3_role_days","Lead has fewer days than a smaller part, or a role works more days than the shoot (+rehearsal it's credited)",L=>{
    const out=[];const n=days(L);const note=String(L.schedule_note||"");
    const by=k=>L.roles.filter(r=>rankOf(r)===k).map(r=>+r.est_days||1);
    const lead=by(0);
    [1,2,3].forEach(k=>{const o=by(k);if(lead.length&&o.length&&Math.min(...lead)<Math.max(...o))out.push({detail:`lead ${Math.min(...lead)}d < rank${k} ${Math.max(...o)}d`});});
    if(by(1).length&&by(2).length&&Math.min(...by(1))<Math.max(...by(2)))out.push({detail:"supporting < day player"});
    const reh=/\brehears/i.test(note)&&!isStage(L)?(plan(L).rehearsal||0):0;
    L.roles.forEach(r=>{const raw=(L._raw._roles||[]).find(x=>x.name===r.name||x._person===r.name||String(x.name).toUpperCase()===r.name)||{};const cap=n+(raw._rehearses?reh:0);if(!isStage(L)&&+r.est_days>cap)out.push({detail:`${r.name} ${r.est_days}d > ${cap}`});});
    return out;
  });
  check(9,"r3_pay_by_size","Pay doesn't follow role size, or the lead isn't above day players without a same-rate note",L=>{
    const out=[];const R=L.roles.map(r=>({r,k:rankOf(r),x:parseRoleRate(r.pay)}));
    R.forEach(a=>R.forEach(b=>{if(a.x&&b.x&&a.x.rate_unit===b.x.rate_unit&&a.k<b.k&&a.x.rate_amount<b.x.rate_amount)out.push({detail:`${a.r.role_type} ${a.r.pay} < ${b.r.role_type} ${b.r.pay}`});}));
    const lead=R.filter(z=>z.k===0&&z.x),dp=R.filter(z=>z.k===2&&z.x);
    if(lead.length&&dp.length&&Math.min(...lead.map(z=>perDay(z.x)))<=Math.max(...dp.map(z=>perDay(z.x)))&&!/\b(same|everyone|every role|all roles|every part|across the board|one rate|whole cast|entire cast|scale|equal)\b/i.test(L.pay))out.push({detail:`lead ${lead[0].r.pay} vs day player ${dp[0].r.pay}: ${L.pay}`});
    return out.slice(0,2);
  });
  check(9,"r3_pronoun_strict","A Female role says 'he' (or a Male role 'she') about the character",L=>L.roles.filter(r=>{const t=String(r.description||"");return (r.gender==="Female"&&/(?:^|[.!?]\s+)(He|His|Him)\b|\bhimself\b/.test(t))||(r.gender==="Male"&&/(?:^|[.!?]\s+)(She|Her)\b|\bherself\b/.test(t));}).map(r=>({detail:`${r.name} ${r.gender}: ${r.description.slice(0,90)}`})));
  check(9,"r3_type_word","'the film' / 'the movie' on a trailer, spot, show, play…",L=>{
    if(FILM_TYPES.test(L.type))return[];
    const t=[L.tagline,L.synopsis,L.pay,L.schedule_note,L.submission_requirements,...L.roles.map(r=>r.description)].join(" ");
    const m=t.match(/[^.]*\b(the|this|our|whole|entire|finished) (film|movie)\b[^.]*/i);
    return m?[{detail:`${L.type}: ${m[0].trim().slice(0,100)}`}]:[];
  });
  check(9,"r3_unexplained_phrase","A character label that needs a backstory ('the grown-up passenger') isn't set up",L=>{
    const out=[];
    L.roles.forEach(r=>{const raw=(L._raw._roles||[]).find(x=>x.name===r.name||x._person===r.name||String(x.name).toUpperCase()===r.name)||{};const s=String(raw._slot||"");if(/\b(grown-up|grown|former|returning)\b/i.test(s)&&!/\b(who|used to|years ago|as a (boy|girl|kid|child|teen)|back when|once|since|from (her|his|their) )\b/i.test(r.description))out.push({detail:`${s}: ${r.description.slice(0,80)}`});});
    if(/\b(the grown-up|the former|the returning|the other)\s+[a-z]+/i.test(L.synopsis))out.push({detail:L.synopsis.slice(0,100)});
    return out;
  });
  const TRAVEL=[[/\bferry\b/i,/ferry|pier|harbor|landing/i],[/\b(city bus|bus driver|bus route|the bus|a bus|bus line)\b/i,/\bbus\b|route|street/i],[/\b(train|subway|commuter rail)\b/i,/train|subway|station|rail|platform/i],[/\b(taxi|cab driver|rideshare|car service)\b/i,/taxi|cab|car|street/i],[/\b(road trip|trucker|long-haul|highway)\b/i,/truck|highway|road|motel|diner|gas station/i]];
  check(9,"r3_location_story","Shoot location doesn't match where the story happens (a bus route shot only in a break room)",L=>{
    if(/^(stage|audio|photo)$/.test(famOf(L.type))||/^(Dance Project|Performance Art|Motion Capture|Animation|Video Game)$/.test(L.type)||/recording|studio|booth|soundstage|capture/i.test(L.shoot_location||""))return[];
    const story=`${L._raw._setupText||""} ${L._raw._turnText||""}`;
    for(const [s,loc] of TRAVEL)if(s.test(story)&&!loc.test(L.shoot_location||""))return[{detail:`${story.slice(0,60)} @ ${L.shoot_location}`}];
    return[];
  });
  check(9,"r3_tagline_vs_first","Tagline repeats the synopsis's first sentence",L=>{
    // Repeating = carrying most of sentence one's content words (the Route 44
    // tagline carried all of them), or being mostly made of them.
    const s1=sentences(L.synopsis)[0]||"";const sw=new Set(clean(s1.replace(/^(this|a|an|the|our|we are making|in this)\s+/i,"")).split(" ").filter(w=>w.length>3));
    const tw=clean(L.tagline).split(" ").filter(w=>w.length>3);const shared=new Set(tw.filter(w=>sw.has(w))).size;
    return !tw.length||shared/Math.max(1,sw.size)>=0.45||shared/tw.length>=0.6||clean(s1).includes(clean(L.tagline))?[{detail:`"${L.tagline}" vs "${s1}"`}]:[];
  });
  check(9,"r3_holidays","Shoot dates on Thanksgiving week, Christmas–New Year or July 4th without the note saying so",L=>{
    if(!L.shoot_start||!L.shoot_end)return[];
    const s=d(L.shoot_start),e=d(L.shoot_end);
    // Plays may run through a holiday; rehearsals, readings and shoots may not.
    const last=isStage(L)&&plan(L).weeks?new Date(s.getTime()+(plan(L).weeks*7-1)*DAY):e;
    const span=(()=>{const a=[];for(let t=s.getTime();t<=last.getTime();t+=DAY)a.push(new Date(t));return a;})();
    return span.some(HOLIDAY)&&!/thanksgiving|christmas|holiday|new year|july 4|fourth of july/i.test(L.schedule_note)?[{detail:`${L.shoot_start} → ${L.shoot_end}`}]:[];
  });
  check(9,"r3_leftovers","'To play N', 'the part will change around you', or a capital letter after a colon",L=>{
    const t=[L.tagline,L.synopsis,L.pay,L.schedule_note,L.submission_requirements,...L.roles.map(r=>r.description)].join("\n");
    const out=[];
    if(/\bTo play \d+\b/.test(t))out.push({detail:(t.match(/[^.]*To play \d+[^.]*/)||[""])[0]});
    if(/the part will change around you/i.test(t))out.push({detail:"the part will change around you"});
    const m=t.match(/:\s+(The|A|An|It|We|You|He|She|They|This|That|Our|Every|Each|No|Nothing|All|Some|And|But|So|If|There|What|Pay|Unpaid|Plus|Everyone)\b/);
    if(m)out.push({detail:(t.match(/.{0,30}:\s+[A-Z]\w+.{0,20}/)||[m[0]])[0]});
    return out;
  });
  check(9,"r3_ethnicity_default","A role not set to 'Any ethnicity'",L=>L.roles.filter(r=>!/^any/i.test(r.ethnicity||"")).map(r=>({detail:`${r.name}: ${r.ethnicity}`})));

  // ── Part B: pay ───────────────────────────────────────────────────────────
  // Current published minimums (see V5_UNION in the generator for sources).
  const MIN={"SAG-AFTRA":1283,"SAG-AFTRA Low Budget":834,"SAG-AFTRA Moderate Low Budget":449.05,"SAG-AFTRA Ultra Low Budget":256.60,"SAG-AFTRA New Media":256.60,"SAG-AFTRA Short Project Agreement":256.60,"SAG-AFTRA Commercial":822.30,"SAG-AFTRA Corporate/Educational":673,"SAG-AFTRA Interactive":1134.95};
  check(9,"r3_union_minimum","Union listing below the agreement's current minimum (or an agreement with no verified rate)",L=>{
    const u=String(L.union_status||"");const out=[];
    if(!/^SAG-AFTRA|^AEA/.test(u))return out;
    if(u==="SAG-AFTRA Student Film")return /defer/i.test(L.pay)?out:[{detail:"student film agreement without deferral stated"}];
    if(u==="AEA Showcase Code")return /showcase/i.test(L.pay)&&!L.roles.some(r=>parseRoleRate(r.pay))?out:[{detail:L.pay}];
    if(!(u in MIN))return[{detail:`no verified minimum for ${u}`}];
    L.roles.forEach(r=>{const x=parseRoleRate(r.pay);const floor=L.type==="Stand-In"?270:rankOf(r)===3&&u==="SAG-AFTRA"?231:MIN[u];if(!x||x.rate_amount+0.001<floor)out.push({detail:`${r.name} ${r.pay} under ${u} ($${floor})`});});
    return out;
  });
  check(9,"r3_unpaid_rules","Unpaid on a union contract, a real-brand commercial or corporate job — or unpaid without saying what actors get",L=>{
    const paid=L.roles.some(r=>parseRoleRate(r.pay));if(paid)return[];
    const out=[];const u=String(L.union_status||"");
    if(/^SAG-AFTRA/.test(u)&&!(u==="SAG-AFTRA Student Film"&&/defer/i.test(L.pay)))out.push({detail:`unpaid on ${u}`});
    if(/^(ad|corp)$/.test(famOf(L.type))&&L.type!=="Spec Commercial")out.push({detail:`unpaid ${L.type}`});
    if(!/\b(copy|footage|credit|meals?|lunch|pizza|snacks|travel|gas|parking|reel|photos|images|audio|program|stipend|deferr|reimburs|coffee|dinner|breakfast|comps?)\b/i.test(L.pay))out.push({detail:`says nothing about what they get: ${L.pay}`});
    return out;
  });
  check(9,"r3_believable_numbers","Rates that aren't believable round numbers ($163/day)",L=>L.roles.map(r=>({r,x:parseRoleRate(r.pay)})).filter(z=>z.x&&!(String(L.union_status).startsWith("SAG-AFTRA")&&MIN[L.union_status])&&z.x.rate_amount>=20&&z.x.rate_amount%5!==0).map(z=>({detail:z.r.pay})));
  check(9,"r3_pay_repeat","Pay box wording (numbers ignored) or a pay sentence reused across listings",null);

  // ── Part C: dates ─────────────────────────────────────────────────────────
  const LEN={"Commercial":[1,2],"Spec Commercial":[1,2],"Social Media Ad":[1,2],"Promo Video":[1,2],"Product Demo":[1,2],"Public Service Announcement":[1,2],"Ad Campaign":[1,2],"Branded Content":[1,2],"Influencer / UGC Content":[1,2],"Photo Shoot":[1,2],"Print Campaign":[1,2],"Modeling":[1,2],"Music Video":[1,2],"Short Film":[1,5],"Student Film":[1,4],"Proof of Concept":[1,3],"Pitch Trailer":[1,3],"Sizzle Reel":[1,3],"Web Series":[2,10],"Feature Film":[12,25],"Independent Film":[12,25],"TV Series":[10,30],"Streaming Series":[10,30],"Limited Series":[10,30],"Miniseries":[10,30],"Voiceover":[1,3],"Table Read":[1,1]};
  check(9,"r3_shoot_length","Shoot length doesn't fit the project type",L=>{const b=LEN[L.type];if(!b)return[];const n=days(L);return n<b[0]||n>b[1]?[{detail:`${L.type}: ${n} days (want ${b[0]}–${b[1]})`}]:[];});
  check(9,"r3_stage_run","Theater rehearsal isn't 2–6 weeks plus a run",L=>{if(!/^(Theater|Off-Broadway Theater|Off-Off-Broadway Theater|Musical Theater)$/.test(L.type))return[];const p=plan(L);return p.weeks>=2&&p.weeks<=6&&p.perfs>=1?[]:[{detail:JSON.stringify({weeks:p.weeks,perfs:p.perfs})}];});
  check(9,"r3_window_fits","Shoot window doesn't fit the number of days (1-day shoot with a 7-day window and no 'between' note)",L=>{
    if(isStage(L)||!L.shoot_start||!L.shoot_end)return[];
    const n=days(L);const win=Math.round((d(L.shoot_end)-d(L.shoot_start))/DAY)+1;const note=String(L.schedule_note||"");
    if(win<n)return[{detail:`${n} days in ${win}-day window`}];
    if(n===1)return win===1||(/\bbetween\b/i.test(note)&&win<=7)?[]:[{detail:`1 day, ${win}-day window: ${note}`}];
    const allow=/saturdays/i.test(note)||plan(L).mode==="saturdays"?n*7:Math.max(n*3+1,Math.ceil(n/5)*7,Math.ceil(n/2)*7);
    // Round 7: a long shoot that breaks for a holiday (and says so) gets that week back.
    const hol=n>=4&&/thanksgiving|christmas|new year|fourth of july/i.test(note)?7:0;
    return win>allow+hol?[{detail:`${n} days in ${win}-day window`}]:[];
  });
  check(9,"r3_deadline_gap","Deadline not 1–4 weeks before the shoot (round 7)",L=>{const g=Math.round((d(L.shoot_start)-d(L.deadline))/DAY);return g<7||g>28?[{detail:`${g} days`}]:[];});
  check(9,"r3_start_1_6_months","Start date not 6 weeks–2 months after posting (round 7)",L=>{const now=d(L._raw._postedAt||new Date().toISOString());const g=Math.round((d(L.shoot_start)-now)/DAY);return g<42||g>60?[{detail:`${L.shoot_start} (${g} days)`}]:[];});
  check(9,"r3_month_spread_note","Months covered by the board",null);
  // Round 9: a unique start date per batch is preferred, then given up -
  // see v5Dates. Two in one batch is no longer a failure.
  check(9,"r3_batch_same_start","Three listings in one batch share a start date",null);
  check(9,"r3_month_cluster","Board clusters in one month (>65% of listings; round 7 starts sit 6 weeks–2 months out, so one board spans two months)",null);

  // ── Part D: synopsis ──────────────────────────────────────────────────────
  // Round 5 asks for runtime, scale and usage in the summary; only
  // casting-process sentences stay banned.
  check(9,"r3_synopsis_production_info","Casting-process info in the synopsis ('The cast is five actors', 'shown to studios')",L=>{const m=String(L.synopsis).match(/[^.]*\b(the cast is|we are casting|we are looking for|roles? (are|is) open|parts? to cast|shown to studios|streamers|sell the (full )?show|scenes are filmed)\b[^.]*/i);return m?[{detail:m[0].trim()}]:[];});
  check(9,"r3_synopsis_shape","Synopsis outside 1–5 sentences, or a short one that gives away the twist",L=>{
    const n=sentences(L.synopsis).length;const out=[];
    if(n<1||n>5)out.push({detail:`${n} sentences`});
    const b=L._raw._synBucket;
    if(b==="short"){const turn=clean(L._raw._turnText||"").split(" ").filter(w=>w.length>3);const syn=clean(L.synopsis);if(n>2||(turn.length>=3&&turn.filter(w=>syn.includes(w)).length/turn.length>=0.55))out.push({detail:`short gives away twist: ${L.synopsis}`});}
    if(b==="medium"&&(n<2||n>3))out.push({detail:`medium with ${n}`});
    if(b==="long"&&(n<4||n>5))out.push({detail:`long with ${n}`});
    return out;
  });

  // ── Part E: schedule notes ────────────────────────────────────────────────
  check(9,"r3_note_contradiction","Schedule note contradicts dates, day count, pattern or evenings",L=>{
    const note=String(L.schedule_note||"");const out=[];const n=days(L);const p=plan(L);
    const m=note.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+) (shoot days?|sessions?|saturdays|weekend (?:shoot )?days|capture days?|event days?)\b/i);
    if(m&&!isStage(L)){const v=W[m[1].toLowerCase()]||+m[1];if(v!==n)out.push({detail:`note ${v} vs ${n}: ${note}`});}
    if(L.shoot_start&&L.shoot_end){const s=d(L.shoot_start),e=d(L.shoot_end);const months=new Set();for(let t=s.getTime();t<=e.getTime();t+=DAY)months.add(new Date(t).getUTCMonth());
      ["January","February","March","April","May","June","July","August","September","October","November","December"].forEach((mn,i)=>{if(new RegExp("\\b"+mn+"\\b").test(note)&&!months.has(i))out.push({detail:`${mn} outside ${L.shoot_start}–${L.shoot_end}`});});
      if(/\bsaturdays?\b/i.test(note)&&!isStage(L)&&s.getUTCDay()!==6)out.push({detail:`Saturday note, starts ${L.shoot_start}`});
      if(/\b(in a row|back to back|consecutive)\b/i.test(note)&&!/not back to back/i.test(note)&&!isStage(L)){const win=Math.round((e-s)/DAY)+1;if(win!==n)out.push({detail:`in a row but ${n} days over ${win}`});}}
    if(/\bevening/i.test(note)&&!isStage(L)&&!p.evening)out.push({detail:`evening note on a day shoot`});
    return out;
  });
  check(9,"r3_note_repeat_opener","Schedule note opener (first 3 words) reused within 30 listings",null);

  // ── Part F: cast size ─────────────────────────────────────────────────────
  check(9,"r3_cast_fits_story","Background stapled onto a small story, or one role for a story about a group",L=>{
    const out=[];const raw=L._raw._roles||[];
    if(L.roles.length<=4&&/^(film|tv|stage)$/.test(famOf(L.type))&&!L._raw._brief&&!/^(Background \/ Extras|Stand-In|Body Double|Stunts)$/.test(L.type)&&L.roles.some(r=>/background/i.test(r.role_type||"")&&!(raw.find(x=>x.name===r.name||x._person===r.name||String(x.name).toUpperCase()===r.name)||{})._storyNeeds))out.push({detail:L.roles.map(r=>r.name).join(", ")});
    if(L.roles.length===1&&/\b(strangers|riders|neighbors|volunteers|family|friends|crew|team|students|customers|guests|players|band|class|regulars|passengers|workers|staff|residents|tenants|kids|children)\b/i.test(L._raw._setupText||""))out.push({detail:`1 role: ${L._raw._setupText}`});
    return out;
  });
  check(9,"r3_mix","Board mix off target by more than 8 points (pay tier, cast size, synopsis length, note detail)",null);

  // ── Board-level: repeats, dates, and the distribution report ─────────────
  addBoard((listings,add)=>{
    const rep={};
    const payKey=t=>clean(t).replace(/\b\d+\b/g,"#").replace(/(# )+/g,"# ");
    const whole=new Map(),sent=new Map();
    listings.forEach(L=>{
      const k=payKey(L.pay);if(whole.has(k))add("r3_pay_repeat",L.id,`whole pay text = ${whole.get(k)}: ${L.pay}`);else whole.set(k,L.id);
      sentences(L.pay).map(payKey).filter(x=>x.split(" ").length>=5).forEach(x=>{if(sent.has(x)&&sent.get(x)!==L.id)add("r3_pay_repeat",L.id,`sentence "${x}" = ${sent.get(x)}`);else sent.set(x,L.id);});
    });
    const byBatch={};listings.forEach(L=>{const b=L._batch;(byBatch[b]=byBatch[b]||[]).forEach(o=>{if(o.shoot_start===L.shoot_start)add("r3_batch_same_start",L.id,`${L.shoot_start} also ${o.id}`);});byBatch[b].push(L);});
    const months={};listings.forEach(L=>{const m=String(L.shoot_start).slice(0,7);months[m]=(months[m]||0)+1;});
    Object.entries(months).forEach(([m,c])=>{if(c>listings.length*0.65)add("r3_month_cluster","board",`${m}: ${c}`);});
    const opener=n=>clean(n).split(" ").slice(0,3).map(w=>/^\d+$|^(one|two|three|four|five|six|seven|eight|nine|ten)$/.test(w)?"#":w).join(" ");
    listings.forEach((L,i)=>{const o=opener(L.schedule_note);if(!o)return;for(let j=Math.max(0,i-30);j<i;j++)if(opener(listings[j].schedule_note)===o){add("r3_note_repeat_opener",L.id,`"${o}" also ${listings[j].id}`);break;}});

    const pct=(c,n)=>Math.round(c*1000/Math.max(1,n))/10;
    const tally=(fn)=>{const t={};listings.forEach(L=>{const k=fn(L);t[k]=(t[k]||0)+1;});return t;};
    const tier=L=>{const rates=L.roles.map(r=>parseRoleRate(r.pay)).filter(Boolean);const u=String(L.union_status||"");
      if(/^SAG-AFTRA(?! Student)/.test(u)&&rates.length)return "union";
      if(!rates.length)return /deferr|reimburs|gas money|stipend/i.test(L.pay)?"deferred":"unpaid";
      if(/stipend|gas money|deferr/i.test(L.pay))return "deferred";
      // Each rate in its own unit (Part B bands): day 50–150 low / 175–350 mid / 400+ high;
      // hour ≤25 / ≤50; week ≤300 / ≤700; session and episode ≤150 / ≤400; flat ≤300 / ≤900.
      const tierOf=r=>{const x=parseRoleRate(r.pay);if(!x)return -1;const p=String(r.pay).toLowerCase(),a=x.rate_amount;const b=(l,m)=>a<=l?0:a<=m?1:2;
        if(/buyout|usage/.test(p))return 2;if(x.rate_unit==="hour")return b(25,50);if(x.rate_unit==="week")return b(300,700);if(/session|episode/.test(p))return b(150,400);if(x.rate_unit==="flat")return b(300,900);return b(150,399);};
      return ["low","mid","high"][Math.max(...L.roles.map(tierOf))]||"mid";};
    const noteTier=L=>L._raw._v5?L._raw._v5.noteTier:"?";
    const TARGETS={pay:{unpaid:15,deferred:10,low:30,mid:25,high:15,union:5},cast:{"1":15,"2":20,"3-4":35,"5-7":20,"8+":10},syn:{short:35,medium:45,long:20},note:{minimal:30,some:40,full:30}};
    const castB=L=>{const n=L.roles.length;return n<=1?"1":n===2?"2":n<=4?"3-4":n<=7?"5-7":"8+";};
    const synB=L=>{const n=sentences(L.synopsis).length;return L._raw._synBucket||(n<=1?"short":n>=4?"long":"medium");};
    rep.pay=tally(tier);rep.cast=tally(castB);rep.syn=tally(synB);rep.note=tally(noteTier);
    Object.entries(TARGETS).forEach(([k,t])=>Object.entries(t).forEach(([b,want])=>{const got=pct(rep[k][b]||0,listings.length);if(Math.abs(got-want)>8)add("r3_mix","board",`${k} ${b}: ${got}% (target ${want}%)`);}));
    rep.months=months;
    rep.structures=tally(L=>L._raw._v5?L._raw._v5.structure:"?");
    rep.unions=tally(L=>L.union_status);
    const lens={};listings.forEach(L=>{(lens[L.type]=lens[L.type]||[]).push(days(L));});rep.lengths=lens;
    rep.synSentences=tally(L=>sentences(L.synopsis).length);
    rep.weekdayModes=tally(L=>(L._raw._v5&&L._raw._v5.plan.mode)||"?");
    rep.evenings=listings.filter(L=>L._raw._v5&&L._raw._v5.plan.evening).length;
    rep.gaps=listings.map(L=>Math.round((d(L.shoot_start)-d(L.deadline))/DAY));
    rep.unpaid=rep.pay.unpaid||0;
    global.__r3report=rep;
    return null;
  },[]);
};
