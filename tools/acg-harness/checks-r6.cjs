// Round 6 checks (2026-09-22): each listing sounds like a different person
// wrote it; the last templates are gone. Written independently of the
// generator's validator (v8Problems).
module.exports=function register({check,addBoard,sentences,clean,famOf,parseRoleRate}){
  const minAge=r=>{const m=String(r.age_range||"").match(/(\d+)\s*-\s*(\d+)/);return m?+m[1]:NaN;};
  const NUMW=/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|\d+)\b/g;
  const namesOf=L=>{const o=[];L.roles.forEach(r=>String(r.name||"").split(/\s+/).forEach(w=>{if(/^[A-Z][a-z'’.-]+$/.test(w))o.push(w);}));(L._raw._crewNames||[]).forEach(n=>String(n).split(/\s+/).forEach(w=>{if(/^[A-Z][a-z'’.-]+$/.test(w))o.push(w);}));return o;};
  const shape=(s,ns)=>{let t=" "+s+" ";ns.slice().sort((a,b)=>b.length-a.length).forEach(n=>{t=t.replace(new RegExp("\\b"+n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b","g")," N ");});return clean(t).replace(NUMW,"#").replace(/\s+/g," ").trim();};
  const allSents=L=>{const o=[];[L.synopsis,L.tagline,L.pay,L.schedule_note,L.submission_requirements].forEach(t=>sentences(t).forEach(s=>o.push({s,f:"text"})));L.roles.forEach(r=>sentences(r.description).slice(1).forEach(s=>o.push({s,f:"role"})));return o.filter(x=>String(x.s).split(/\s+/).length>=5);};

  // ── Part A ────────────────────────────────────────────────────────────────
  check(12,"r6_unpaid_first","Unpaid listing whose pay box doesn't open with 'Unpaid.'",L=>{
    const priced=L.roles.some(r=>parseRoleRate(r.pay));
    if(priced||/deferr|stipend|gas money|reimburs|showcase/i.test(L.pay)||/Student Film/.test(L.union_status||""))return[];
    return /^Unpaid\./.test(L.pay)?[]:[{detail:L.pay}];
  });
  check(12,"r6_age_vs_timespan","A time-span phrase (years of, decades, veteran, retired, since he was…) the age range can't have lived",L=>{
    const out=[];const raw=L._raw._roles||[];
    L.roles.forEach(r=>{
      const x=raw.find(z=>z.name===r.name||z._person===r.name||String(z.name).toUpperCase()===r.name)||{};if(x._group)return;
      const t=`${x._slot||""} ${r.description||""}`;let need=0;
      if(/\bretired\b|\bold-timer\b/i.test(t))need=60;
      else if(/\bdecades\b|\blong career\b|\bthirty years\b|\bforty years\b/i.test(t))need=40;
      else if(/\bveteran\b|\btwenty years\b/i.test(t))need=35;
      else if(/\bover the years\b|\bfor years\b|\byears of\b|\bmany years\b|\blifelong\b|\ball (his|her|their) life\b/i.test(t))need=28;
      else if(/\bsince (he|she|they) was (a )?(kid|boy|girl|child|teen|teenager)\b/i.test(t))need=25;
      const n=t.match(/\bfor (\d{1,2}|ten|eleven|twelve|fifteen|twenty|thirty|forty) years\b/i);
      if(n){const w=n[1].toLowerCase();const v=/^\d+$/.test(w)?+w:{ten:10,eleven:11,twelve:12,fifteen:15,twenty:20,thirty:30,forty:40}[w];need=Math.max(need,v+18);}
      if(need&&minAge(r)<need)out.push({detail:`${r.name} ${r.age_range}: ${(t.match(/[^.]*\b(years|decades|veteran|retired|since|career|lifelong|old-timer)\b[^.]*/i)||[""])[0].trim().slice(0,70)}`});
    });
    return out;
  });
  const SERIES_T=/^(TV Series|Streaming Series|Web Series|Vertical Series|Limited Series|Miniseries|Reality \/ Docu-Series|Lifestyle \/ Unscripted|Podcast \/ Audio Drama|Educational Video|Hosting \/ Presenter)$/;
  check(12,"r6_scope","Title/roles say series (module, episode…) while the summary says one piece",L=>{
    const series=SERIES_T.test(L.type)||/\b(\d+|two|three|four|five|six|seven|eight|nine|ten)[- ](episode|module|part|lesson|chapter)|\bseries\b/i.test(L.synopsis);
    const claim=/\b(module|modules|episode|episodes|installment|chapter|chapters|lesson|lessons|part (one|two|three|four|five|\d))\b/i.test(L.title)||L.roles.some(r=>/\bevery (module|episode|lesson|chapter)\b|\bin each (module|episode|lesson|chapter)\b/i.test(r.description||""));
    return claim&&!series?[{detail:`"${L.title}" vs "${(sentences(L.synopsis)[0]||"").slice(0,80)}"`}]:[];
  });
  const GENERIC=/^(brand|company|business|shoot|shoots|shot|day|days|week|weeks|casting|cast|film|short|feature|series|episode|episodes|minute|minutes|session|sessions|actors|actor|men|women|man|woman|performances|performance|roles|role|video|spot|campaign|show|play|musical|background|models|model|hosts|host|voice|single|about|with|from|this|that|scripted|reenactment)$/;
  const STOPW=/^(the|and|for|who|was|are|has|had|his|her|its|one|two|out|off|all|not|but|you|our|can)$/;
  check(12,"r6_tagline_echo","Tagline and summary share a distinctive two-word phrase",L=>{
    const tw=new Set(clean(`${L.type||""} ${L._raw._brandCat||""}`).split(" ").filter(Boolean).map(w=>w.replace(/s$/,"")).concat(["work","booking","ads","demo"]));const st=w=>tw.has(w)||tw.has(w.replace(/s$/,""));
    const bi=t=>{const w=clean(t).split(" ").filter(Boolean),o=new Set();for(let i=0;i+1<w.length;i++){const a=w[i],b=w[i+1];if(st(a)||st(b))continue;if(a.length>2&&b.length>2&&!GENERIC.test(a)&&!GENERIC.test(b)&&!STOPW.test(a)&&!STOPW.test(b))o.add(a+" "+b);}return o;};
    const S=bi(L.synopsis);const hit=[...bi(L.tagline)].filter(x=>S.has(x));
    return hit.length?[{detail:`"${hit[0]}": ${L.tagline}`}]:[];
  });

  // ── Part C: roles ────────────────────────────────────────────────────────
  const BANNED=/Whatever \w+ wants, \w+ is the person in the way|\w+'s biggest scenes are (at|in|on) .* opposite \w+ as the|The relationship that matters most for \w+ is with|Most of \w+'s time is spent (at|in|on) /i;
  check(12,"r6_mirrored_patterns","The four banned slot-filled role sentences, or two roles sharing a sentence with names swapped",L=>{
    const out=[];const t=L.roles.map(r=>r.description).join(" ");
    if(BANNED.test(t))out.push({detail:(t.match(BANNED)||[""])[0]});
    const ns=namesOf(L);const seen=new Map();
    L.roles.forEach(r=>sentences(r.description).slice(1).forEach(z=>{if(z.split(/\s+/).length<4)return;const k=shape(z,ns);if(seen.has(k)&&seen.get(k)!==r.name)out.push({detail:`"${z}" also on ${seen.get(k)}`});seen.set(k,r.name);}));
    return out;
  });
  check(12,"r6_struct_in_listing","A role-description structure used twice in one listing",L=>{
    const s=(L._raw._v8&&L._raw._v8.structs)||[];
    return new Set(s).size!==s.length?[{detail:s.join(", ")}]:[];
  });
  check(12,"r6_struct_window","A role structure in more than 2 of any 20 consecutive listings",null);

  // ── Part D: summaries ────────────────────────────────────────────────────
  check(12,"r6_banned_openers","A banned summary opener ('about what happens when', 'shows the moment', 'is all about')",L=>/\babout what happens when\b|\bshows the moment\b|\bis all about\b/i.test(sentences(L.synopsis)[0]||"")?[{detail:sentences(L.synopsis)[0]}]:[]);
  check(12,"r6_opener_variety","Fewer than 12 distinct opening shapes on the board",null);
  check(12,"r6_facts_position","The practical facts sit in the closing sentence on more than half the board",null);

  // ── Part E: repetition ───────────────────────────────────────────────────
  check(12,"r6_shape_window","A sentence shape (any field) reused within 50 listings",null);
  check(12,"r6_shape_in_listing","A sentence shape used twice inside one listing",L=>{
    const ns=namesOf(L);const seen=new Set();const out=[];
    allSents(L).forEach(x=>{const k=shape(x.s,ns);if(seen.has(k))out.push({detail:x.s.slice(0,80)});seen.add(k);});
    return out.slice(0,1);
  });
  check(12,"r6_open6_window","Summary opening six words reused within 50 listings",null);
  check(12,"r6_tagline_shape_window","A tagline skeleton in more than 3 of any 20 listings",null);
  check(12,"r6_persona","Persona repeats back to back, or warmth off the 30/40/30 mix by more than 10 points",null);

  addBoard((listings,add)=>{
    const rep={};
    // Structures per 20-listing window.
    for(let i=0;i<listings.length;i++){
      const win=listings.slice(Math.max(0,i-19),i+1);
      const c={};win.forEach(L=>new Set((L._raw._v8&&L._raw._v8.structs)||[]).forEach(k=>c[k]=(c[k]||0)+1));
      Object.entries(c).forEach(([k,n])=>{if(n>2&&(listings[i]._raw._v8||{structs:[]}).structs.indexOf(k)>-1)add("r6_struct_window",listings[i].id,`${k} ×${n} in listings ${Math.max(1,i-18)}–${i+1}`);});
      const t={};win.forEach(L=>{const k=(L._raw._v8||{}).tagSkel;if(k)t[k]=(t[k]||0)+1;});
      const mine=(listings[i]._raw._v8||{}).tagSkel;if(mine&&t[mine]>3)add("r6_tagline_shape_window",listings[i].id,`"${mine}" ×${t[mine]}`);
    }
    // Shapes and openings per 50-listing window.
    const lastSeen=new Map(),lastOpen=new Map();
    listings.forEach((L,i)=>{
      const ns=namesOf(L);
      new Set(allSents(L).map(x=>shape(x.s,ns))).forEach(k=>{if(lastSeen.has(k)&&i-lastSeen.get(k)<50)add("r6_shape_window",L.id,`"${k.slice(0,70)}" (${i-lastSeen.get(k)} listings apart)`);lastSeen.set(k,i);});
      const o=clean(L.synopsis).split(" ").slice(0,6).join(" ");
      if(lastOpen.has(o)&&i-lastOpen.get(o)<50)add("r6_open6_window",L.id,`"${o}"`);lastOpen.set(o,i);
    });
    // Opening shapes: first four words with the type label masked.
    const TYPEW=/\b(short film|feature film|feature-length film|student film|student short|independent film|indie feature|experimental film|experimental short|proof-of-concept short|proof-of-concept film|documentary|documentary feature|tv series|television series|tv pilot|pilot episode|streaming series|streaming show|web series|online series|sizzle reel|pitch trailer|limited series|miniseries|vertical series|vertical drama series|pilot presentation|docu-series|reality series|unscripted series|lifestyle show|hosted show|hosted series|stage play|theater production|off-broadway play|off-broadway production|off-off-broadway play|off-off-broadway production|stage musical|new musical|staged reading|workshop reading|table read|commercial|social media ad|branded video|branded short|promo video|product demo video|spec commercial|spec ad|ad campaign|public service announcement|psa|ugc creator campaign|influencer campaign|corporate video|company video|training video|educational video series|educational video|print campaign|print ad campaign|photo shoot|modeling shoot|modeling campaign|voiceover project|voiceover job|audio drama|scripted podcast|animated series|animated short|video game|story-driven video game|music video|dance film|dance piece|performance art piece|motion-capture project|motion-capture shoot|live event|live show|background actors|background performers|stand-ins|a body double|stunt performers)\b/gi;
    const shapes={};listings.forEach(L=>{const k=clean((sentences(L.synopsis)[0]||"").replace(TYPEW,"TYPE")).split(" ").slice(0,4).join(" ");shapes[k]=(shapes[k]||0)+1;});
    const distinct=Object.keys(shapes).length;
    if(distinct<12)add("r6_opener_variety","board",`${distinct} distinct opening shapes`);
    // Where the practical facts sit.
    const FACT=/\b(\d+-minute|\d+-episode|\d+-part|made (over|in|across)|shoot days?|sessions?|runs online|online use|voice only|stills only|the work is|expect )\b/i;
    let last=0,tot=0;const pos={first:0,middle:0,last:0,split:0};
    listings.forEach(L=>{const s=sentences(L.synopsis);const idx=s.map((z,i)=>FACT.test(z)?i:-1).filter(i=>i>=0);if(!idx.length)return;tot++;
      if(idx.length>1)pos.split++;else if(idx[0]===0)pos.first++;else if(idx[0]===s.length-1){pos.last++;last++;}else pos.middle++;});
    if(tot&&last/tot>0.5)add("r6_facts_position","board",`${last}/${tot} closing`);
    rep.factsPos=pos;
    // Personas.
    const per={},warm={};let prev=null,rep2=0;
    listings.forEach(L=>{const v=L._raw._v8||{};per[v.persona]=(per[v.persona]||0)+1;warm[v.warmth]=(warm[v.warmth]||0)+1;if(prev&&prev===v.persona)rep2++;prev=v.persona;});
    if(rep2)add("r6_persona","board",`${rep2} back-to-back repeats`);
    const n=listings.length;[["warm",30],["plain",40],["brisk",30]].forEach(([w,t])=>{const p=Math.round((warm[w]||0)*100/n);if(Math.abs(p-t)>10)add("r6_persona","board",`${w} ${p}% (target ${t}%)`);});
    const leak=listings.filter(L=>/\b(castassoc|castoffice|lineprod|brandmgr|corpvendor|mvdirector|indieprod|commcd|theaterad|docprod|firsttime|persona)\b/i.test([L.tagline,L.synopsis,L.pay,L.schedule_note,L.submission_requirements].join(" "))).length;
    if(leak)add("r6_persona","board",`persona label visible on ${leak} listings`);
    rep.personas=per;rep.warmth=warm;rep.openShapes=distinct;
    // Template detector: sentences clustered by structure (function words and
    // punctuation kept, content words collapsed); clusters over 3 members.
    const docs=[];listings.forEach(L=>{const ns=namesOf(L);allSents(L).forEach(x=>docs.push({s:x.s,f:x.f,id:L.id,ns}));});
    const df={};docs.forEach(d=>new Set(clean(shape(d.s,d.ns)).split(" ")).forEach(w=>{df[w]=(df[w]||0)+1;}));
    const frame=w=>w==="n"||w==="#"||(df[w]||0)>=docs.length*0.03;
    const sig=d=>{const w=clean(shape(d.s,d.ns)).split(" ");const o=[];w.forEach(x=>{const t=frame(x)?x:"_";if(t==="_"&&o[o.length-1]==="_")return;o.push(t);});return o.join(" ");};
    const cl={};docs.forEach(d=>{const k=sig(d);(cl[k]=cl[k]||{n:0,ids:new Set(),ex:[]}).n++;cl[k].ids.add(d.id);if(cl[k].ex.length<2)cl[k].ex.push(d.s);});
    rep.templates=Object.entries(cl).filter(([k,v])=>v.ids.size>3&&k.replace(/_/g,"").trim().split(" ").length>=3).sort((a,b)=>b[1].ids.size-a[1].ids.size).slice(0,15).map(([k,v])=>({sig:k,listings:v.ids.size,ex:v.ex}));
    global.__r6report=rep;
    return null;
  },[]);
};
