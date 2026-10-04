#!/usr/bin/env node
// Round 10 report (2026-10-04).
//
//   node tools/acg-harness/r10-report.cjs [--n 300] [--batch 10] [--batches 10] [--preused 6]
//                                          [--cards out.txt] [--seed 7]
//
// Two runs, the way the owner asked for them: a long run of N listings in
// batches of ten, and a fresh run of ten batches of ten. Every number below is
// measured on the PRINTED listings by this script's own checks, not by asking
// the generator whether it thinks it obeyed its rules.
const {loadACG}=require("./load.cjs");
const fs=require("fs");
const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf(k);return i>-1?args[i+1]:d;};
const N=+arg("--n","300"),B=+arg("--batch","10"),NB=+arg("--batches","10");
const PRE=args.includes("--preused")?(+arg("--preused","6")||6):0;

function run(total,batch){
  const L=loadACG();
  const {ACG,store,ctx}=L;
  const seen=[];
  if(PRE)require("./dump-seeds.cjs").slice(PRE).forEach(sd=>seen.push({key:"seed "+sd.k.replace(/[^a-z0-9]+/g," ").trim(),kind:"story"}));
  const listings=[],batches=[];let rounds=0;const t0=Date.now();
  while(listings.length<total&&rounds<total){
    rounds++;store.clear();ctx.__acgShiftDays=(rounds-1)*3;
    const got=ACG.generateBatch("admin",listings.map(x=>x._raw),Math.min(batch,total-listings.length),seen.slice());
    if(!got.length){console.log(`  !! batch ${rounds} came back empty`);break;}
    const ids=[];
    got.forEach(raw=>{
      const saved={...Object.fromEntries(Object.entries(raw).filter(([k])=>k[0]!=="_")),roles:(raw._roles||[]).map(r=>({...r})),_raw:{...raw,roles:raw._roles},_batch:rounds,_skel:raw._skel,_v5:raw._v5,_key:raw._r8Key||raw.type};
      ids.push(listings.length);listings.push(saved);
      ACG.seenRowsFor(raw).forEach(r=>seen.push(r));
    });
    batches.push(ids);
  }
  return {listings,batches,ms:Date.now()-t0,ACG,src:L.src,ctx};
}

// ── Classification ─────────────────────────────────────────────────────────
const GROUP={
  narrative:/^(Feature Film|Independent Film|Short Film|Student Film|Experimental Film|Proof of Concept|Pitch Trailer|Sizzle Reel|TV Series|Streaming Series|TV Pilot|Limited Series|Miniseries|Pilot Presentation|Web Series|Vertical Series)$/,
  theater:/^(Theater|Off-Broadway Theater|Off-Off-Broadway Theater|Musical Theater|Workshop \/ Staged Reading|Table Read)$/,
  commercial:/^(Commercial|Spec Commercial|Ad Campaign|Social Media Ad|Influencer \/ UGC Content|Branded Content|Promo Video)$/,
  stills:/^(Photo Shoot|Print Campaign|Modeling)$/,
  voice:/^(Voiceover|Podcast \/ Audio Drama|Animation|Video Game|Motion Capture)$/,
  music:/^(Music Video)$/,
  corporate:/^(Corporate Video|Industrial \/ Training Video|Product Demo|Educational Video|Public Service Announcement)$/,
  docu:/^(Documentary|Reality \/ Docu-Series|Lifestyle \/ Unscripted|Hosting \/ Presenter|Live Event)$/
};
const TARGET={narrative:50,theater:8,commercial:22,stills:6,voice:5,music:3,corporate:4,docu:2,other:0};
const groupOf=t=>Object.keys(GROUP).find(k=>GROUP[k].test(t))||"other";
const isNarr=t=>/^(narrative|theater)$/.test(groupOf(t));
const isComm=t=>groupOf(t)==="commercial";
const parseRate=p=>{const s=String(p||"").toLowerCase();if(/copy|credit|meals|deferred|unpaid/.test(s)&&!/\$/.test(s))return null;const m=s.match(/\$\s*([\d,]+(?:\.\d+)?)/);if(!m)return null;const a=parseFloat(m[1].replace(/,/g,""));const u=/\/day|per day|a day/.test(s)?"d":/\/week|per week/.test(s)?"w":/\/hour|per hour|an hour/.test(s)?"h":"f";return {a,u};};
const RANK={Lead:0,Principal:0,"Principal Voice":0,"Series Regular":0,Supporting:1,"Day Player":2,Featured:2,Background:3,Ensemble:3};
const rk=r=>{const t=String(r.role_type||"");return /background|ensemble/i.test(t)?3:/day player|featured/i.test(t)?2:/^(lead|principal|series regular|principal voice|host)$/i.test(t)?0:1;};
// Same amounts in the same listing shape, whatever the parts are called.
const rateSet=L=>{const x=L.roles.map(r=>parseRate(r.pay)).filter(Boolean);if(!x.length)return "";return x.sort((a,b)=>b.a-a.a).map(p=>`${p.a}${p.u}`).join("|");};
const headline=L=>{const m=String(L.pay||"").match(/^Roles paying up to \$([\d,]+(?:\.\d\d)?)\./);return m?m[1]:null;};
const ORDER={Lead:0,"Series Regular":1,Principal:2,Supporting:3,"Co-Star":4,Recurring:5,"Guest Star":6,Featured:7,"Real People":7,"Content Creators":7,Models:7,Host:8,"Day Player":9,Voiceover:10,Singer:11,Dancer:12,Ensemble:13,Understudy:14,Swing:15,"Stand-In":16,"Photo Double":17,"Body Double":18,"Stunt Performer":19,"Featured Background":20,Background:21};
const coShape=n=>{const s=String(n||"");if(/ & /.test(s))return "pair";if(/^(Studio|Unit|Stage|Room|Floor) [A-Z]/.test(s))return "studio";if(/thesis|degree|program/i.test(s))return "thesis";if(/^The [A-Z][a-z]+ (Collective|Group|Workshop|Cooperative|Company)$/.test(s))return "collective";if(/^(Independent|Privately|Self-financed|Company-produced|Cooperative)/.test(s))return "plain";if(/^[A-Z]{2,4} /.test(s))return "initials";return "name:"+s.split(" ")[0];};

// ── Step 4 checks, written independently of the generator ──────────────────
const UK=/\b(neighbour\w*|colour\w*|favour\w*|behaviour\w*|honour\w*|labour\w*|harbour\w*|centre\w*|theatre\w*|programme\w*|conservatoire|recognis\w*|organis\w*|realis(e|ed|es|ing)\b|travell(ed|ing|er)\w*|sceptic\w*|rota|car park|solicitor|high street|fortnight|petrol|tyres?|lay-by|motorway|postman|councillor|estate agent|haulage|portacabin|pub|queue)\b/i;
const STEP4=[
  ["4a wrong noun for a character",L=>{const out=[];const ppl=L.roles.filter(r=>!/background/i.test(r.role_type||""));const firsts={};ppl.forEach(r=>{firsts[String(r.name).split(/[ ,]/)[0]]=r;});const head=r=>{const s=String(r._slot||"").toLowerCase().replace(/^(the|a|an)\s+/,"").split(/ (?:at|in|on|with|of|from|for|who|that|by) /)[0].split(" ");return s[s.length-1];};
    ppl.forEach(r=>{const d=String(r.description||"");let m;const re=/\b(?:That|This|The|Our) ([a-z-]+) is ([A-Z][a-z'’-]+)\b/g;while((m=re.exec(d))){const w=firsts[m[2]];if(w&&ppl.some(o=>head(o)===m[1])&&head(w)!==m[1])out.push(m[0]);}});
    if(/\b(the (garage|street|car|roadside|station|route|terminus) includes|methodical about the (garage|street|car))\b/i.test(L.synopsis+" "+L.roles.map(r=>r.description).join(" ")))out.push("place noun in a person slot");return out;}],
  ["4b broken title",L=>{const t=String(L.title||"");const q=(t.match(/^'([^']+?),?'/)||[])[1]||t;return /\b(the|a|an|of|at|in|on|to|for|with|from|by|and|or)$/i.test(q.trim())||/\b(at|from) the (Street|Road|Route|Car|Roadside|Shoulder|Town)\b/.test(q)?[t]:[];}],
  ["4c schedule note contradiction",L=>{const n=String(L.schedule_note||"");const out=[];if(/\b(TBD|TBC)\b/.test(n)&&/\b(days are (set|firm|fixed)|dates are (set|firm|fixed)|won't move|will not move)\b/i.test(n))out.push(n);if((n.match(/\b(TBD|TBC)\b/g)||[]).length>1)out.push("TBD twice: "+n);return out;}],
  ["4d owner at a public place",L=>/\b(library|school|hospital|museum|post office|police station|precinct|courthouse|city hall|church|fire station)\b/i.test(String(L.shoot_location||""))?L.roles.filter(r=>/\b(owner|landlord|proprietor)\b/i.test(`${r._slot||""} ${r.name||""}`)).map(r=>r.name):[]],
  ["4e dangling line",L=>L.roles.map(r=>String(r.description||"")).filter(d=>/(^|[.!?]\s)(Genuinely |Still |Just )?(does not|doesn't|cannot|can't) (understand|see|know|explain) (why|it|that|how)\./i.test(d))],
  ["4f grammar",L=>{const t=[L.title,L.tagline,L.synopsis,L.pay,L.schedule_note,L.submission_requirements,...L.roles.map(r=>r.description)].join(" \n");const out=[];if(/\b[Aa] (8|11|18|8\d)\b/.test(t))out.push("a + vowel-sound number");
    String(L.synopsis||"").split(/(?<=[.!?])\s+/).forEach(s=>{const b=s.replace(/^(Logline|Synopsis):\s*/,"");if(/^(Logline|Synopsis):/.test(s)&&/^(a|an|the)\s[^,.]*\bwho\b[^,.]*,\s*and now\b/i.test(b))out.push("fragment: "+s);if((b.match(/\babout\b/gi)||[]).length>1&&/\babout (a|an|one|two|three|four|five|six|\d+) (day|days|week|weeks)\b/i.test(b))out.push("about twice: "+s);});
    const bi=String(L.synopsis||"").search(/\bboth of them\b/i);if(bi>-1&&(String(L.synopsis).slice(0,bi).match(/\b(and|two|both|couple|pair|brothers|sisters|friends)\b/gi)||[]).length<1)out.push("both of them without two people");return out;}],
  ["4g scene away from the location",L=>{const where=String(`${L.shoot_location||""} ${L._raw._r8Venue||""} ${L.synopsis||""}`).toLowerCase();const out=[];L.roles.forEach(r=>{const d=String(r.description||"");const m=d.match(/\b(at home(?! (on|in|with|around|behind|among)\b)|in the lead.s kitchen|at (his|her|their) house)\b/i);if(m&&!/\b(home|house|apartment|kitchen)\b/.test(where))out.push(`${r.name}: ${m[0]}`);});return out;}],
  ["4h repeated word in a description",L=>{const out=[];L.roles.forEach(r=>{const own=new Set(String(`${r.name} ${r._slot||""} ${r._person||""} ${L.shoot_location||""}`).toLowerCase().replace(/[^a-z ]/g," ").split(/\s+/));const c={};String(r.description||"").toLowerCase().replace(/[^a-z ]/g," ").split(/\s+/).filter(w=>w.length>=6&&!own.has(w)&&!/^(family|client|patient|parent|student|agent|moment|event|content|apartment|department|president|resident|restaurant|assistant|attendant|servant|tenant|accountant|consultant|participant|applicant|merchant|sergeant)s?$/.test(w)&&/(ly|ful|ous|ive|ic|ent|ant|able|ible|ish|less|ady|ical)$|^(steady|careful|quiet|patient|friendly|polite|methodical|cheerful|nervous|stubborn|gentle|honest|natural)$/.test(w)).forEach(w=>{c[w]=(c[w]||0)+1;});Object.keys(c).filter(w=>c[w]>1).forEach(w=>out.push(`${r.name}: ${w}`));});return out;}],
  ["4i mixed name styles",L=>{const ppl=L.roles.filter(r=>!/background/i.test(r.role_type||"")&&!/^(Participant|Reenactment):/.test(r.name)&&!r._group&&!r._job);const lab=ppl.filter(r=>/^[A-Z][a-z'’-]+, [A-Z]/.test(r.name));return lab.length&&lab.length<ppl.length?lab.map(r=>r.name):[];}],
  ["US spelling",L=>{const t=[L.title,L.tagline,L.synopsis,L.pay,L.schedule_note,L.submission_requirements,L.prod,...L.roles.map(r=>`${r.name} ${r.description}`)].join(" ");const m=t.match(UK);return m?[m[0]]:[];}],
  ["crew surname = company name",L=>{const co=new Set(String(L.prod||"").toLowerCase().split(/\W+/).filter(w=>w.length>2));return String(L.crew_credits||"").split(" · ").map(x=>x.replace(/^[^:]+:\s*/,"").trim()).filter(n=>n.split(" ").slice(1).some(w=>co.has(w.toLowerCase())));}]
];

function report(name,R,withBatches){
  const {listings:Ls,batches}=R;
  const n=Ls.length;
  console.log(`\n══ ${name}: ${n} listings in ${batches.length} batches (${(R.ms/1000).toFixed(1)}s) ══`);
  // 1. Type distribution vs targets
  const g={};Ls.forEach(L=>{const k=groupOf(L.type);g[k]=(g[k]||0)+1;});
  console.log("Type mix by group (got% / target%): "+Object.keys(TARGET).map(k=>`${k} ${(100*(g[k]||0)/n).toFixed(1)}/${TARGET[k]}`).join(" · "));
  const tc={};Ls.forEach(L=>{tc[L.type]=(tc[L.type]||0)+1;});
  console.log("Types: "+Object.entries(tc).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(" · "));
  // 3. Dropdown types never generated, and per-150 windows
  const OPTS=JSON.parse(R.src.match(/const PROJECT_TYPE_OPTIONS=(\[[^\]]*\])/)[1]);
  const never=OPTS.filter(t=>!tc[t]);
  console.log(`Dropdown types never generated: ${never.length}${never.length?" → "+never.join(", "):""}`);
  if(n>=150){let worst=[];for(let i=0;i+150<=n;i++){const s=new Set(Ls.slice(i,i+150).map(L=>L.type));const miss=OPTS.filter(t=>!s.has(t));if(miss.length>worst.length)worst=miss;}console.log(`Worst 150-listing window misses ${worst.length} dropdown type(s)${worst.length?": "+worst.join(", "):""}`);}
  // 2. Per batch
  if(withBatches){
    console.log("Per batch: non-narrative / commercial / max of one type / company-shape repeats");
    batches.forEach((ids,i)=>{const b=ids.map(j=>Ls[j]);const nn=b.filter(L=>!isNarr(L.type)).length,cm=b.filter(L=>isComm(L.type)).length;const c={};b.forEach(L=>{c[L.type]=(c[L.type]||0)+1;});const mx=Math.max(...Object.values(c));const sh={};b.forEach(L=>{const s=coShape(L.prod);sh[s]=(sh[s]||0)+1;});const rep=Object.values(sh).filter(v=>v>1).length;
      console.log(`  batch ${String(i+1).padStart(2)}: ${nn} non-narrative ${nn>=3?"✓":"✗"} · ${cm} commercial ${cm>=1?"✓":"✗"} · max ${mx} of one type ${mx<=1?"✓":"✗"} · ${rep} company-shape repeats ${rep?"✗":"✓"} · ${b.map(L=>L.type.replace(/ \/ .*/,"")).join(", ")}`);});
  }
  {// rolling windows of ten (stricter than fixed batches)
    let badNN=0,badC=0,badT=0;for(let i=0;i+10<=n;i++){const w=Ls.slice(i,i+10);if(w.filter(L=>!isNarr(L.type)).length<3)badNN++;if(!w.some(L=>isComm(L.type)))badC++;const c={};w.forEach(L=>{c[L.type]=(c[L.type]||0)+1;});if(Math.max(...Object.values(c))>1)badT++;}
    console.log(`Rolling 10-listing windows failing: non-narrative<3 ${badNN} · no commercial ${badC} · a type twice ${badT} (of ${Math.max(0,n-9)})`);}
  // 4. Headline repeats within 15
  {let rep=0;const ex=[];Ls.forEach((L,i)=>{const h=headline(L);if(!h)return;const prev=Ls.slice(Math.max(0,i-14),i).map(headline);if(prev.indexOf(h)>-1){rep++;if(ex.length<3)ex.push(`$${h} (#${i+1})`);}});console.log(`Headline "Roles paying up to $X" repeated within 15 listings: ${rep}${ex.length?" e.g. "+ex.join(", "):""}`);
   const hs={};Ls.slice(0,Math.min(n,60)).forEach(L=>{const h=headline(L);if(h)hs[h]=(hs[h]||0)+1;});console.log(`  most common headline in the first 60: ${Object.entries(hs).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`$${k}×${v}`).join(", ")}`);}
  // 5. Rate sets within 100
  {let rep=0;const ex=[];Ls.forEach((L,i)=>{const k=rateSet(L);if(!k)return;const j=Ls.slice(Math.max(0,i-99),i).findIndex(o=>rateSet(o)===k);if(j>-1){rep++;const o=Ls[Math.max(0,i-99)+j];if(ex.length<3)ex.push(`${k} (#${i+1} ${L.type}/${L.union_status} vs #${Math.max(0,i-99)+j+1} ${o.type}/${o.union_status}: ${L.roles.map(r=>r.role_type+" "+r.pay).join(", ")} || ${o.roles.map(r=>r.role_type+" "+r.pay).join(", ")})`);}});console.log(`Identical rate set within 100 listings: ${rep}${ex.length?" e.g. "+ex.join(", "):""}`);}
  // 6. Pay structure mix
  {const st={};Ls.forEach(L=>{let s=(L._v5&&L._v5.structure)||"?";if(/^SAG/.test(L.union_status||"")&&s==="union")s="union scale";if(/^Payment not specified/.test(L.pay))s="not specified";st[s]=(st[s]||0)+1;});console.log("Pay structures: "+Object.entries(st).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${(100*v/n).toFixed(1)}%`).join(" · "));
   const sh={};Ls.forEach(L=>{const k=String(L.pay||"").replace(/^Roles paying up to \$[\d,.]+\.\s*/,"").replace(/\$[\d,.]+/g,"$").replace(/\b\d+\b/g,"#").split(/[.;:]/)[0].trim().split(/\s+/).slice(0,4).join(" ");sh[k]=(sh[k]||0)+1;});
   console.log(`Pay-text openings: ${Object.keys(sh).length} distinct over ${n}; most used: ${Object.entries(sh).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`"${k||"(headline only)"}"×${v}`).join(", ")}`);
   const nu=Ls.filter(L=>/^(Feature Film|Independent Film)$/.test(L.type)&&!/^SAG/.test(L.union_status||"")).map(L=>Math.max(0,...L.roles.map(r=>{const p=parseRate(r.pay);return p&&p.u==="d"?p.a:0;})));
   console.log(`Non-union features: ${nu.length}, top day rate max $${nu.length?Math.max(...nu):0} (cap $350)`);}
  // 7. Skeleton repeats
  {let rep=0;const ex=[];Ls.forEach((L,i)=>{if(!L._skel)return;if(Ls.slice(Math.max(0,i-149),i).some(o=>o._skel===L._skel)){rep++;if(ex.length<3)ex.push(`${L._skel} (#${i+1})`);}});console.log(`Premise skeleton repeated within 150: ${rep}${ex.length?" e.g. "+ex.join(", "):""}`);
   let inb=0;batches.forEach(ids=>{const s=ids.map(j=>Ls[j]._skel);if(new Set(s).size<s.length)inb++;});console.log(`Batches with a repeated skeleton: ${inb}`);}
  // 8. Step 4
  STEP4.forEach(([nm,fn])=>{let f=0;const ex=[];Ls.forEach(L=>{const r=fn(L);if(r.length){f++;if(ex.length<2)ex.push(String(r[0]).slice(0,90));}});console.log(`  ${f?"✗":"✓"} ${nm}: ${f}${ex.length?" e.g. "+ex.join(" | "):""}`);});
  // 9. Role order
  {let bad=0;Ls.forEach(L=>{for(let i=1;i<L.roles.length;i++){const a=L.roles[i-1],b=L.roles[i];const ra=ORDER[a.role_type]??99,rb=ORDER[b.role_type]??99;if(ra>rb||(ra===rb&&(+a.est_days||0)<(+b.est_days||0))){bad++;break;}}});console.log(`Role-order violations: ${bad}`);}
  // 10. Company shapes
  {let r20=0;for(let i=0;i<n;i++){const w=Ls.slice(Math.max(0,i-19),i+1).map(L=>coShape(L.prod));const me=w[w.length-1];if(!/^name:/.test(me)&&w.filter(x=>x===me).length>2)r20++;}
   const pairs=Ls.filter(L=>/ & /.test(L.prod||"")).length,units=Ls.filter(L=>/^(Unit|Room) /.test(L.prod||"")).length;
   console.log(`Company shapes over 2 per 20 listings: ${r20} · "Surname & Surname" ${pairs} of ${n} · "Unit/Room N" ${units} of ${n}`);}
}

const A=run(N,B);
report(`Run A (${N} listings, batches of ${B}${PRE?", premise bank spent":""})`,A,false);
const Bn=run(NB*B,B);
report(`Run B (${NB} batches of ${B})`,Bn,true);

// ── Board cards and full listings ──────────────────────────────────────────
const CARDS=arg("--cards",null);
if(CARDS){
  const out=[];
  const card=L=>{const top=headline(L);return `┌ ${L.title}\n│ ${L.type} · ${L.union_status} · ${L.location}\n│ ${String(L.synopsis||"").slice(0,220)}${String(L.synopsis||"").length>220?"…":""}\n│ ${L.pay}\n│ Roles: ${L.roles.map(r=>`${r.name} (${r.role_type}${r.est_days?`, ${r.est_days}d`:""}, ${r.pay})`).join(" · ")}\n└ ${L.prod} · ${L.crew_credits}`;};
  const full=L=>[`════ ${L.title}`,`Type: ${L.type} · ${L.union_status} · Posted by ${L.prod} · Casting: ${L.casting_director_name}`,`Location: ${L.location} · Where: ${L.shoot_location||"—"} · Dates: ${L.shoot_start||"—"} to ${L.shoot_end||"—"} · Deadline ${L.deadline}`,`Tagline: ${L.tagline}`,`Summary: ${L.synopsis}`,`Pay: ${L.pay}`,`Schedule: ${L.schedule_note}`,`Submit: ${L.submission_requirements}`,`Crew: ${L.crew_credits}`,...L.roles.map(r=>`  • ${r.name} — ${r.role_type}, ${r.gender}, ${r.age_range}, ${r.pay}${r.est_days?`, ${r.est_days} day(s)`:""}\n    ${r.description}`)].join("\n");
  out.push("ONE BATCH OF 10 AS BOARD CARDS (Run B, batch 1)\n");
  Bn.batches[0].forEach(j=>out.push(card(Bn.listings[j])));
  const all=A.listings.concat(Bn.listings);
  [["a commercial",/^Commercial$/],["a music video",/^Music Video$/],["a voiceover job",/^Voiceover$/],["a photo shoot",/^Photo Shoot$/]].forEach(([w,re])=>{const L=all.find(x=>re.test(x.type));out.push(`\n\nFULL LISTING — ${w}\n`+(L?full(L):"(none generated)"));});
  fs.writeFileSync(CARDS,out.join("\n\n"));
  console.log(`\nCards and full listings written to ${CARDS}`);
}
