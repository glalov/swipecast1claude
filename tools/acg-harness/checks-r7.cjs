// Round 7 checks (2026-09-22): role naming by format, shoot dates close to the
// posting date, every role with a counterpart, no cross-field contradictions,
// the location is the venue. Written independently of the generator's
// validators (v7RelProblems / v7Contradictions / castingDateProblems).
module.exports=function register({check,addBoard,sentences,clean,famOf}){
  const DAY=86400000;
  const d=s=>{const x=String(s||"").slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(x)?new Date(x+"T12:00:00Z"):null;};
  const posted=L=>d(L._raw._postedAt)||d(L.created_at)||(()=>{const t=new Date();t.setUTCHours(12,0,0,0);return t;})();
  const FN=/^(Commercial|Spec Commercial|Branded Content|Social Media Ad|Influencer \/ UGC Content|Corporate Video|Industrial \/ Training Video|Educational Video|Product Demo|Public Service Announcement|Promo Video|Ad Campaign|Print Campaign|Photo Shoot|Modeling|Live Event|Background \/ Extras|Stand-In|Body Double|Stunts|Music Video|Voiceover)$/;
  const NARRATIVE=/^(Feature Film|Independent Film|Short Film|Student Film|TV Series|Streaming Series|Limited Series|Miniseries|TV Pilot|Web Series|Vertical Series|Theater|Off-Broadway Theater|Off-Off-Broadway Theater|Musical Theater|Animation|Video Game|Podcast \/ Audio Drama)$/;
  const isFnName=n=>/[A-Z]{2}/.test(String(n))&&/^[A-Z0-9][A-Z0-9 '’&\/.-]*( \([A-Z][a-z]+\))?$/.test(String(n));
  const isPersonName=n=>/^[A-Z][a-z'’.-]+( [A-Z]\.)? [A-Z][a-z'’-]+$/.test(String(n));
  const groupRole=(L,r)=>{const x=(L._raw._roles||[]).find(z=>z.name===r.name||z._person===r.name||String(z.name).toUpperCase()===r.name)||{};return !!(x._group||x._job)||/background|extras|ensemble|crowd|players|voices/i.test(r.name);};

  // ── 1. Role naming by format ─────────────────────────────────────────────
  check(13,"r7_role_naming","Commercial-world roles named with a person's name, or narrative roles with none",L=>{
    const out=[];
    L.roles.filter(r=>!groupRole(L,r)).forEach(r=>{
      if(FN.test(L.type)&&isPersonName(r.name))out.push({detail:`${L.type}: "${r.name}" should be the function`});
      if(NARRATIVE.test(L.type)&&isFnName(r.name))out.push({detail:`${L.type}: "${r.name}" should be a character name`});
    });
    // A function-named listing keeps no leftover first names in its text.
    if(FN.test(L.type)){
      const old=L._raw._fnOldNames||[];
      const t=[L.synopsis,L.tagline,L.pay,L.schedule_note,L.submission_requirements,...L.roles.map(r=>r.description)].join(" ");
      old.forEach(n=>{if(new RegExp("\\b"+String(n).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b").test(t))out.push({detail:`"${n}" still named in a function-cast listing`});});
    }
    return out;
  });

  // ── 2. Dates ─────────────────────────────────────────────────────────────
  check(13,"r7_start_window","Shoot start not 6 weeks–2 months after the listing was posted",L=>{
    const st=d(L.shoot_start);if(!st)return[];
    const g=Math.round((st-posted(L))/DAY);
    return g<42||g>60?[{detail:`${L.shoot_start} is ${g} days out`}]:[];
  });
  check(13,"r7_date_order","Dates that can't all be true (deadline/expiry/start/end/posted, note days, role days)",L=>{
    const out=[];
    const st=d(L.shoot_start),en=d(L.shoot_end),dl=d(L.deadline),ex=d(L.expires_at),po=posted(L);
    if(dl&&st&&dl>=st)out.push({detail:`deadline ${L.deadline} on/after start ${L.shoot_start}`});
    if(ex&&st&&ex>=st)out.push({detail:`expires ${String(L.expires_at).slice(0,10)} on/after start ${L.shoot_start}`});
    if(ex&&dl&&ex<dl)out.push({detail:`expires before deadline`});
    if(st&&en&&en<st)out.push({detail:`ends before it starts`});
    if(po&&dl&&po>dl)out.push({detail:`posted after the deadline`});
    if(po&&st&&po>st)out.push({detail:`posted after the shoot start`});
    const W={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fifteen:15,twenty:20};
    const note=String(L.schedule_note||"");let nd=0,m;
    const re=/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)[- ](?:(?:shoot|shooting|work|filming|recording|production)[- ])?days?\b(?! a week| per week| each week| a month| before| after| notice| ahead| out| in advance| later| earlier| of rehearsal)/gi;
    while((m=re.exec(note))){const w=m[1].toLowerCase();const n=/^\d+$/.test(w)?+w:W[w];if(n>nd)nd=n;}
    const win=st&&en&&en>=st?Math.round((en-st)/DAY)+1:st?1:0;
    if(nd&&win&&nd>win)out.push({detail:`note says ${nd} days, window holds ${win}`});
    const total=nd||win;
    if(total)L.roles.forEach(r=>{if(+r.est_days>total)out.push({detail:`${r.name}: ${r.est_days} days of a ${total}-day shoot`});});
    return out;
  });
  // Round 9: two per start date is a preference, not a wall - the 19-day
  // window cannot always honour it, and enforcing it emptied whole batches.
  // Three is the point at which it stops looking deliberate.
  check(13,"r7_start_cluster","More than three listings share a shoot start date",null);

  // ── 3. Every role exists in the story ────────────────────────────────────
  const PAIRS=[
    [/\b(parent|mother|father|mom|dad|guardian|stepmother|stepfather)\b/i,/\b(child|children|kid|kids|son|daughter|baby|infant|toddler|teen|teenager|minor|pupil|student|patient)\b/i,"a child"],
    [/\b(son|daughter|stepson|stepdaughter)\b/i,/\b(parent|mother|father|mom|dad|guardian|grandmother|grandfather|grandparent)\b/i,"a parent"],
    [/\b(wife|husband|spouse|fiancée|fiancee|fiancé|fiance|newlywed|bride|groom)\b/i,/\b(wife|husband|spouse|fiancée|fiancee|fiancé|fiance|newlywed|bride|groom|partner|marriage|married|wedding)\b/i,"a spouse"],
    [/\b(brother|sister|sibling|twin)\b/i,/\b(brother|sister|sibling|twin)\b/i,"a sibling"],
    [/\b(boss|supervisor|manager|foreman)\b/i,/\b(employee|worker|staff|staffer|assistant|intern|trainee|apprentice|crew|team|clerk|server|driver|technician|hand)\b/i,"someone who works for them"],
    [/\b(caregiver|carer|home aide|caretaker)\b/i,/\b(patient|resident|client|elder|parent|mother|father|grandparent|child)\b/i,"the person they care for"]
  ];
  check(13,"r7_role_counterpart","A relationship role whose counterpart is nowhere in the cast or the summary",L=>{
    const out=[];
    const raw=L._raw._roles||[];
    const slotOf=r=>(raw.find(z=>z.name===r.name||z._person===r.name||String(z.name).toUpperCase()===r.name)||{})._slot||"";
    const syn=`${L.synopsis||""} ${L.tagline||""}`;
    const people=L.roles.filter(r=>!groupRole(L,r));
    people.forEach(r=>{
      const mine=`${slotOf(r)} ${r.description||""}`;
      PAIRS.forEach(([re,need,what])=>{
        if(!re.test(mine))return;
        const ok=L.roles.some(o=>o.name!==r.name&&need.test(`${slotOf(o)} ${o.name||""} ${o.description||""}`))||need.test(syn)
          ||(/\b(parent|mother|father|mom|dad|guardian)\b/i.test(mine)&&people.some(o=>o.name!==r.name&&parseInt(String(o.age_range).split("-")[1],10)<18));
        if(!ok)out.push({detail:`${r.name}: "${(mine.match(re)||[""])[0]}" with no ${what}`});
      });
    });
    return out;
  });

  // ── 4. No self-contradiction across fields ───────────────────────────────
  check(13,"r7_contradiction","Two fields that can't both be true (camera address, dialogue, days, pay)",L=>{
    const out=[];
    const rolesText=L.roles.map(r=>r.description||"").join(" ");
    const board=`${L.synopsis||""} ${L.tagline||""} ${L.schedule_note||""}`;
    const all=`${board} ${rolesText}`;
    const strip=t=>String(t).replace(/\b(no|not|never|without|nothing)\b[^.;]*/gi," ");
    const OBS=/\b(documentary[- ]style|filmed like a documentary|shot like a documentary|fly[- ]on[- ]the[- ]wall|observational|as if the camera isn'?t there|no polished pitch to camera)\b/i;
    const DIRECT=/\b(direct address|direct[- ]to[- ]camera|straight (in)?to the lens|to the lens|down the barrel|pitch to camera)\b/i;
    if(OBS.test(all)&&DIRECT.test(strip(all)))out.push({detail:"documentary-style and straight to camera"});
    const SILENT=/\b(no dialogue|without dialogue|no lines|nobody (talks|speaks)|silent|wordless)\b/i;
    if(SILENT.test(board)&&/\b(dialogue|lines|speeches|monologue)\b/i.test(strip(rolesText)))out.push({detail:"no dialogue in the summary, dialogue in a role"});
    if(/\b(one|a single) (shoot |recording |filming )?day\b/i.test(board)&&L.roles.some(r=>+r.est_days>1))out.push({detail:"one day in the summary, more on a role"});
    const pay=String(L.pay||"");
    if(/^unpaid\b/i.test(pay)&&/\$\s*\d/.test(pay.replace(/\b(stipend|travel|meal|gas|mileage|per diem)[^.]*/gi," ")))out.push({detail:"unpaid and a rate"});
    return out;
  });

  // ── 5. Scene-partner templates ───────────────────────────────────────────
  check(13,"r7_partner_templates","A banned scene-partner template, or both halves of a pair carrying partner lines",L=>{
    const out=[];
    const BAN=/main scene partner is|relationship that matters most for|biggest scenes are (at|in|on) .* opposite|Whatever \w+ wants, \w+ is the person/i;
    L.roles.forEach(r=>{const m=String(r.description||"").match(BAN);if(m)out.push({detail:`${r.name}: "${m[0]}"`});});
    const names=L.roles.map(r=>String(r.name));
    const pairs=new Set();
    L.roles.forEach(r=>{
      const d=String(r.description||"");
      names.filter(n=>n!==r.name&&d.indexOf(n)>-1).forEach(n=>{
        const k=[r.name,n].sort().join("|");
        if(pairs.has(k))out.push({detail:`${r.name} and ${n} both describe the pairing`});else pairs.add(k);
      });
    });
    return out;
  });

  // ── 6. Location is the venue, not a corner of it ─────────────────────────
  const SUB=/^(a|an|the)\s+(\w+\s+)?(front desk|reception|break ?room|locker room|changing room|green room|waiting (room|area)|dressing room|storage room|back office|back room|staff room|utility room|rest ?room|bathroom|stairwell|hallway|corridor|parking lot|car park|loading dock|lobby|foyer|mezzanine|counter|kitchen|basement|rooftop|entrance|doorway|driveway|porch|stoop|aisle|balcony|cubicle)$/i;
  check(13,"r7_sublocation","Shoot location names a room instead of the venue",L=>{
    const venue=String(L.shoot_location||"").split(",")[0].trim();
    return venue&&SUB.test(venue)?[{detail:L.shoot_location}]:[];
  });

  addBoard((listings,add)=>{
    const st={};
    // Round 8: only a start the listing prints can collide on the board.
    listings.forEach(L=>{const s0=L.real?L.real.shoot_start:L.shoot_start;if(s0)st[s0]=(st[s0]||0)+1;});
    Object.entries(st).forEach(([k,n])=>{if(n>3)add("r7_start_cluster","board",`${k}: ${n}`);});
    const fnL=listings.filter(L=>FN.test(L.type)).length;
    global.__r7report={startDates:Object.keys(st).length,startMax:Math.max(0,...Object.values(st)),fnListings:fnL};
    return null;
  },[]);
};
