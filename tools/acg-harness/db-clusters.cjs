// Round 7: run the round-6 template detector against real listings from the
// database, not just harness output.
//
//   node tools/acg-harness/db-clusters.cjs <export.json|txt>
//
// The input is whatever a query like this returns (a JSON array, or a file
// with one embedded in it):
//   select c.id,c.title,c.type,c.synopsis,c.tagline,c.schedule_note,
//          (select json_agg(json_build_object('name',r.name,'description',r.description))
//             from roles r where r.casting_id=c.id) roles
//     from castings c where c.is_admin_created order by c.created_at desc limit 250;
const fs=require("fs");
const raw=fs.readFileSync(process.argv[2],"utf8");
const i=raw.indexOf("[{");
if(i<0){console.error("no JSON array in that file");process.exit(1);}
let depth=0,end=-1;
for(let j=i;j<raw.length;j++){const ch=raw[j];if(ch==="[")depth++;else if(ch==="]"){depth--;if(!depth){end=j;break;}}}
let rows=JSON.parse(raw.slice(i,end+1));
if(rows.length===1&&rows[0].j)rows=rows[0].j;

const clean=s=>String(s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const sentences=t=>String(t||"").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
const NUMW=/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|\d+)\b/g;
// Content words are masked out; what's left is the frame of the sentence.
const FRAME=/^(the|a|an|and|or|but|of|to|in|on|at|for|with|is|are|was|were|be|been|it|its|this|that|these|those|you|your|we|our|they|their|he|she|his|her|him|as|by|from|into|over|under|about|most|more|less|all|every|each|no|not|never|only|just|still|then|than|so|if|when|while|who|whom|whose|what|which|there|here|has|have|had|does|do|did|can|will|would|should|could|up|down|out|off|per|via|s|t)$/;
const names=L=>{const o=new Set();(L.roles||[]).forEach(r=>String(r.name||"").split(/\s+/).forEach(w=>{if(/^[A-Z][a-z'’.-]+$/.test(w))o.add(w.toLowerCase());}));return o;};
const sig=(s,ns)=>clean(s).replace(NUMW,"#").split(" ").map(w=>ns.has(w)?"n":(FRAME.test(w)||w==="#"||w==="n"?w:"_")).join(" ").replace(/(?:^| )_(?: _)+/g," _").trim();

const BANNED=[
  [/main scene partner is/i,"X's main scene partner is Y"],
  [/relationship that matters most for/i,"The relationship that matters most for X is with Y"],
  [/biggest scenes are (at|in|on) .*opposite/i,"X's biggest scenes are at … opposite Y"],
  [/Whatever \w+ wants, \w+ is the person/i,"Whatever X wants, Y is the person in the way"],
  [/Most of \w+'s time is spent (at|in|on) /i,"Most of X's time is spent at …"]
];
const clusters=new Map();const banned=[];
rows.forEach(L=>{
  const ns=names(L);
  const texts=[L.synopsis,L.tagline,L.schedule_note,...(L.roles||[]).map(r=>r.description)];
  texts.forEach(t=>sentences(t).forEach(s=>{
    BANNED.forEach(([re,label])=>{if(re.test(s))banned.push({id:L.id,title:L.title,label,s});});
    if(clean(s).split(" ").length<5)return;
    const k=sig(s,ns);if(!k||k.split(" ").length<3)return;
    if(!clusters.has(k))clusters.set(k,{n:new Set(),e:s});
    clusters.get(k).n.add(L.id);
  }));
});
console.log(`DB template detector — ${rows.length} listings`);
if(banned.length){
  console.log(`\n  BANNED PATTERNS STILL PRESENT (${banned.length}):`);
  banned.slice(0,20).forEach(b=>console.log(`    [${b.title}] ${b.label}\n        ${b.s.slice(0,120)}`));
}else console.log("\n  Banned scene-partner patterns: none");
const top=[...clusters.entries()].filter(([,v])=>v.n.size>3).sort((a,b)=>b[1].n.size-a[1].n.size);
console.log(`\n  Sentence clusters over more than 3 listings (${top.length}):`);
top.slice(0,20).forEach(([k,v])=>console.log(`    [${v.n.size} listings] ${k}\n        e.g. ${v.e.slice(0,120)}`));
