// Round 4 checks (2026-09-19): the nine faults the owner found on live drafts.
// Registered by run.cjs. Written independently of the generator's validator
// (v6Problems) — the two must agree, but neither is derived from the other.
module.exports=function register({check,addBoard,sentences,clean,famOf,parseRoleRate}){
  const DAY=86400000;
  const d=s=>new Date(String(s).slice(0,10)+"T12:00:00Z");
  const plan=L=>(L._raw._v5&&L._raw._v5.plan)||{};
  const days=L=>plan(L).days||L._raw._shootDays||1;
  const isLead=r=>/^(Lead|Principal|Principal Voice)$/i.test(r.role_type||"")||+r.est_days>=5;

  // 1. The schedule note repeats neither the dates nor the location.
  const MONTHS=/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/i;
  check(10,"r4_note_no_dates","Schedule note carries a date, a month name or a day number",L=>{
    const n=String(L.schedule_note||"");const out=[];
    [[MONTHS,"month"],[/\b\d{1,2}\s*\/\s*\d{1,2}\b/,"numeric date"],[/\b\d{1,2}(st|nd|rd|th)\b/i,"day of month"],[/\b20\d\d\b/,"year"]].forEach(([re,what])=>{
      if(re.test(n))out.push({detail:`${what}: "${(n.match(re)||[""])[0]}" in "${n}"`});});
    return out;
  });
  check(10,"r4_note_no_location","Schedule note repeats the shoot location or city",L=>{
    const n=String(L.schedule_note||"");
    const loc=String(L.shoot_location||"");
    const area=loc.replace(/^[^,]*,\s*/,"").replace(/\s*\([^()]*\)\s*$/,"").trim();
    const city=String(L.location||"").split(",")[0].trim();
    const out=[];
    [area,city].forEach(x=>{if(x.length>3&&new RegExp("\\b"+x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","i").test(n))out.push({detail:`"${x}" in "${n}"`});});
    return out;
  });

  // The admin editors show an orange warning when the note carries a date.
  // Run the REAL warning function from source over every generated note.
  const warnFn=(()=>{
    const src=require("fs").readFileSync(require("path").join(__dirname,"..","..","swipecast-full.jsx"),"utf8");
    const re=src.match(/const NOTE_DATE_RE=[^\n]+/),f1=src.match(/function scheduleNoteAddendum\(note\)\{[\s\S]*?\n\}/),f2=src.match(/function scheduleNoteHasDate\(note\)\{[\s\S]*?\n\}/);
    if(!re||!f1||!f2)return null;
    return Function(`${re[0]}\n${f1[0]}\n${f2[0]}\nreturn scheduleNoteHasDate;`)();
  })();
  check(10,"r4_admin_date_warning","The admin's orange 'dates in your schedule note' warning fires on this draft",L=>{
    if(!warnFn)return[{detail:"scheduleNoteHasDate() not found in source"}];
    return warnFn(L.schedule_note)?[{detail:L.schedule_note}]:[];
  });

  // 2. The top-rate chip is a rate, not a multi-day total (UI code).
  check(10,"r4_top_rate_chip","Casting page shows a multi-day total where it says a rate",()=>{
    const src=require("fs").readFileSync(require("path").join(__dirname,"..","..","swipecast-full.jsx"),"utf8");
    const m=src.match(/Paid roles up to<\/span>[\s\S]{0,160}?<\/span>/);
    if(!m)return[{detail:"'Paid roles up to' line not found"}];
    return /fmtTopRate\(/.test(m[0])?[]:[{detail:m[0].replace(/\s+/g," ").slice(0,120)}];
  },{once:true});

  // 3. Pay fits the format.
  const LONG=/^(Miniseries|Limited Series|TV Series|Streaming Series|TV Pilot|Pilot Presentation)$/;
  const BRAND=/^(Commercial|Ad Campaign|Branded Content|Corporate Video|Industrial \/ Training Video|Promo Video|Product Demo|Social Media Ad|Print Campaign|Modeling|Public Service Announcement)$/;
  const EXPLAINED=/\b(thesis|student|deferred|defer|co-?op|collective|no budget|passion project|profit share|points|micro-?budget|unpaid)\b/i;
  const minDay=L=>BRAND.test(L.type)||LONG.test(L.type)?150:(/^(Feature Film|Independent Film)$/.test(L.type)&&days(L)>10?150:0);
  const total=r=>{const x=parseRoleRate(r.pay);if(!x)return 0;const n=Math.max(1,+r.est_days||1),t=String(r.pay).toLowerCase();
    if(x.rate_unit==="week")return x.rate_amount*Math.max(1,Math.ceil(n/5));
    if(x.rate_unit==="hour")return x.rate_amount*8*n;
    if(x.rate_unit==="flat"&&/session|episode/.test(t))return x.rate_amount*n;
    if(x.rate_unit==="flat")return x.rate_amount;
    return x.rate_amount*n;};
  check(10,"r4_pay_fits_format","Unpaid or near-unpaid on a format that always pays",L=>{
    const floor=minDay(L);
    if(!floor||/^SAG|^AEA/.test(L.union_status||"")||EXPLAINED.test(L.pay||""))return[];
    return L.roles.map(r=>{
      const x=parseRoleRate(r.pay);
      if(!x)return {detail:`${r.name}: unpaid on ${L.type}`};
      const per=x.rate_unit==="hour"?x.rate_amount*8:x.rate_unit==="week"?x.rate_amount/5:x.rate_amount;
      return per<floor?{detail:`${r.name} ${r.pay} < $${floor}/day on ${L.type}`}:null;
    }).filter(Boolean);
  });
  const MIN_BUDGET={"Miniseries":6000,"Limited Series":6000,"TV Series":6000,"Streaming Series":6000,"TV Pilot":3000,"Pilot Presentation":2000,"Feature Film":6000,"Independent Film":4000,"Commercial":1200,"Ad Campaign":1200,"Branded Content":1200,"Corporate Video":1200,"Industrial / Training Video":1000,"Print Campaign":1000,"Modeling":800};
  check(10,"r4_cast_budget","Whole-cast budget too small to be believable for the format",L=>{
    const m=MIN_BUDGET[L.type];if(!m||EXPLAINED.test(L.pay||""))return[];
    const sum=L.roles.reduce((a,r)=>a+total(r),0);
    return sum<m?[{detail:`${L.type}, ${days(L)} days: $${Math.round(sum)} total cast (floor $${m})`}]:[];
  });

  // 4. Flat "same rate for everyone" is the exception.
  // Two leads on one rate is normal. One rate across different SIZES of part
  // is the thing the owner wants kept rare.
  const rankK=r=>/^(Lead|Principal|Principal Voice)$/i.test(r.role_type||"")?0:/background|ensemble/i.test(r.role_type||"")?3:/day player|featured/i.test(r.role_type||"")?2:1;
  const flatAll=L=>{const priced=L.roles.filter(r=>parseRoleRate(r.pay));const a=priced.map(r=>{const x=parseRoleRate(r.pay);return x.rate_amount+"|"+x.rate_unit;});return a.length>1&&new Set(a).size===1&&new Set(priced.map(rankK)).size>1;};
  check(10,"r4_flat_when_fitting","One rate for every role on a project that should tier by role size",L=>{
    if(!flatAll(L)||/^SAG|^AEA/.test(L.union_status||""))return[];
    const people=L.roles.filter(r=>!/background|ensemble/i.test(r.role_type||"")).length;
    const bg=L.roles.length-people;
    if(days(L)<=2||L.roles.length<=3||bg>=Math.ceil(L.roles.length/2))return[];
    return[{detail:`${L.type}, ${days(L)} days, ${L.roles.length} roles, all at ${L.roles[0].pay}`}];
  });
  check(10,"r4_flat_share","More than 12% of listings pay every role the same",null);

  // 5. The shoot location is the main venue, not a side room.
  const SIDE=/\b(break room|locker room|changing room|green room|waiting room|storage room|supply closet|back office|staff room|utility room|restroom|bathroom|stairwell|hallway|corridor|parking lot|loading dock|lobby)\b/i;
  check(10,"r4_main_venue","Shoot location names only a side room",L=>{
    const venue=String(L.shoot_location||"").split(",")[0];
    return SIDE.test(venue)&&!/\band its\b|\band the\b/i.test(venue)?[{detail:L.shoot_location}]:[];
  });

  // 6. The tagline hooks the story the summary tells.
  check(10,"r4_tagline_matches","Tagline describes a different story from the summary",L=>{
    const stop=/^(about|after|again|against|around|because|before|being|between|could|every|from|into|just|like|more|most|much|only|other|over|same|some|such|than|that|them|then|there|these|they|this|those|through|under|until|very|what|when|where|which|while|with|would|your|their|have|will|been|were|does|make|makes|made|take|takes|come|comes|goes|going|keep|keeps|says|said|gets)$/;
    const words=t=>clean(t).split(" ").filter(w=>w.length>3&&!stop.test(w));
    const sw=new Set(words(L.synopsis)),tw=words(L.tagline);
    const shared=new Set(tw.filter(w=>sw.has(w))).size;
    // A summary that already tells the twist matches a twist-shaped hook.
    if(L._raw._brief)return[];   // a brief's hook is its approach, not a plot
    const turn=words(L._raw._turnText||"");
    if(turn.length>=3&&turn.filter(w=>sw.has(w)).length/turn.length>=0.55)return[];
    return tw.length&&shared<2?[{detail:`"${L.tagline}" vs "${sentences(L.synopsis)[0]||""}"`}]:[];
  });

  // 7. Leads have enough to act on.
  const REL=/\b(rival|rivals|partner|partners|boss|sibling|siblings|ex|best friend|competitor|neighbou?r|roommate|co-?worker|colleague|mentor|assistant|understudy)\b/i;
  check(10,"r4_lead_depth","A lead (or a 5+ day role) has too little to act on, or a relationship with nobody named",L=>{
    const out=[];
    const raw=L._raw._roles||[];
    L.roles.filter(r=>{const x=raw.find(z=>z.name===r.name)||{};return !x._group&&!x._job&&isLead(r);}).forEach(r=>{
      const t=String(r.description||"");
      const fnName=/[A-Z]{2}/.test(r.name)&&r.name===r.name.toUpperCase().replace(/\([A-Z][A-Z]+\)/,m=>m);
      // Round 7: function-named commercial roles read like real breakdowns — short.
      if(/^[A-Z0-9 '’&\/.()-]+$/.test(String(r.name).replace(/\([A-Z][a-z]+\)/,""))&&/[A-Z]{2}/.test(r.name)?t.split(/\s+/).length<12:(sentences(t).length<2||t.split(/\s+/).length<18))out.push({detail:`${r.name} (${r.role_type}, ${r.est_days}d): ${t}`});
      const firsts=L.roles.filter(o=>o.name!==r.name).map(o=>String(o.name).split(" ")[0]);
      // Round 7: a role's own job title ("the new assistant") is not a relationship.
      const slot=String((raw.find(z=>z.name===r.name)||{})._slot||"").replace(/^(the|a|an)\s+/i,"");
      const own=slot?new RegExp("\\b("+slot.split(/\s+/).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")\\b","ig"):null;
      const rel=own?t.replace(own,""):t;
      if(REL.test(rel)&&!firsts.some(n=>t.indexOf(n)>-1))out.push({detail:`${r.name}: "${(rel.match(REL)||[""])[0]}" with nobody named`});
    });
    return out;
  });

  // 8. Dates.
  check(10,"r4_dates","Expiration not 0–3 days after the deadline, or deadline/expiration/shoot out of order",L=>{
    const now=d(L._raw._postedAt||new Date().toISOString());
    const out=[];
    const exp=L.expires_at?d(L.expires_at):null,dl=L.deadline?d(L.deadline):null,st=L.shoot_start?d(L.shoot_start):null;
    // Round 7: expiration on the deadline or up to 3 days after, before the shoot.
    if(exp&&dl){const n=Math.round((exp-dl)/DAY);if(n<0||n>3)out.push({detail:`expires ${n} days after the deadline`});}
    if(exp&&st&&!(exp<st))out.push({detail:`expires ${L.expires_at} not before shoot ${L.shoot_start}`});
    if(exp&&dl&&exp<dl)out.push({detail:`expires ${L.expires_at} before deadline ${L.deadline}`});
    if(dl&&st&&!(dl<st))out.push({detail:`deadline ${L.deadline} not before shoot ${L.shoot_start}`});
    if(dl&&dl<now)out.push({detail:`deadline ${L.deadline} already past`});
    return out;
  });

  // 9. Submission requirements match what the roles ask for.
  check(10,"r4_submissions_match","Listing asks everyone for something only some roles need",L=>{
    const s=String(L.submission_requirements||"");const out=[];
    const exception=/\balso\b|only the|for the lead|of the roles/i.test(s);
    const allReel=L.roles.every(r=>(r.required_media||[]).indexOf("reel")>-1);
    const allSelf=L.roles.every(r=>r.prescreen==="selftape");
    if(/\breel\b|recent footage|shot recently/i.test(s)&&!allReel&&!exception)out.push({detail:"reel asked of everyone: "+s.slice(0,110)});
    if(/self-tape|selftape/i.test(s)&&!allSelf&&!exception)out.push({detail:"self-tape asked of everyone: "+s.slice(0,110)});
    return out;
  });

  addBoard((listings,add)=>{
    const flats=listings.filter(L=>flatAll(L)&&!/^SAG|^AEA/.test(L.union_status||"")).length;
    const pct=Math.round(flats*1000/Math.max(1,listings.length))/10;
    if(pct>12)add("r4_flat_share","board",`${flats}/${listings.length} = ${pct}%`);
    global.__r4report={flatPct:pct,
      noteFacts:(()=>{const t={};listings.forEach(L=>{const n=String(L.schedule_note||"");
        const k=[/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(shoot|session|capture|event|weekend|rehearsal|performance)/i.test(n)&&"day count",/\b\d{1,2}(:\d\d)?(am|pm)\b/i.test(n)&&"call time",/rehears/i.test(n)&&"rehearsal",/weekend|saturday|sunday|weekday|monday|tuesday|wednesday|thursday|friday/i.test(n)&&"pattern",/fitting|travel|van|parking|turnaround|weather day|call sheet/i.test(n)&&"logistics"].filter(Boolean);
        (k.length?k:["flexible only"]).forEach(x=>t[x]=(t[x]||0)+1);});return t;})(),
      leadWords:(()=>{const a=[];listings.forEach(L=>L.roles.filter(isLead).forEach(r=>a.push(String(r.description||"").split(/\s+/).length)));return a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):0;})(),
      budgets:(()=>{const t={};listings.forEach(L=>{const m=MIN_BUDGET[L.type];if(!m)return;t[L.type]=(t[L.type]||[]).concat(Math.round(L.roles.reduce((a,r)=>a+total(r),0)));});return t;})()};
    return null;
  },[]);
};
