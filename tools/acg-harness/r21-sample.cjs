#!/usr/bin/env node
// Round 21: print whole listings the way the owner reads them.
//   node tools/acg-harness/r21-sample.cjs [--n 30] [--batch 5]
const {loadACG}=require("./load.cjs");
const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf(k);return i>-1?args[i+1]:d;};
const N=+arg("--n","30"),B=+arg("--batch","5");
const {ACG,store,ctx}=loadACG();
const seen=[];const listings=[];const WHY={};let rounds=0;
while(listings.length<N&&rounds<N){
  rounds++;store.clear();ctx.__acgShiftDays=(rounds-1)*3;
  const batch=ACG.generateBatch("admin",listings,Math.min(B,N-listings.length),seen.slice());
  const lr=ctx.__acgLastRun;
  Object.entries(lr.why||{}).forEach(([k,v])=>{WHY["build: "+k]=(WHY["build: "+k]||0)+v;});
  (lr.rejectLog||[]).forEach(x=>x.problems.forEach(p=>{const k=p.replace(/: .*$/,"");WHY[k]=(WHY[k]||0)+1;}));
  batch.forEach(raw=>{listings.unshift({...raw,roles:raw._roles,created_at:new Date(Date.now()+listings.length*1000).toISOString()});ACG.seenRowsFor(raw).forEach(r=>seen.push(r));});
  if(!batch.length)break;
}
console.log("made",listings.length,"in",rounds,"batches");
const tally=(f)=>{const m={};listings.forEach(l=>{const k=f(l);m[k]=(m[k]||0)+1;});return JSON.stringify(Object.entries(m).sort((a,b)=>b[1]-a[1]));};
console.log("cities",tally(l=>l.location));
console.log("loc styles",tally(l=>l._r21Loc||"-"));
console.log("types",tally(l=>l.type));
console.log("syn sentences",tally(l=>{const n=(String(l.synopsis).match(/[.!?](\s|$)/g)||[]).length;return n<=1?"1":n<=3?"2-3":n<=5?"4-5":"6+";}));
console.log("top rejects",JSON.stringify(Object.entries(WHY).sort((a,b)=>b[1]-a[1]).slice(0,14)));
listings.slice().reverse().forEach((l,i)=>{
  console.log(`\n#${i+1} [${l.type}] ${l.title} | ${l.prod} | ${l.crew_credits}`);
  console.log(`  TAG: ${l.tagline}`);
  console.log(`  SYN: ${l.synopsis}`);
  console.log(`  LOC: ${l.location} || ${l.shoot_location} | ${l.shoot_start}..${l.shoot_end} dl ${l.deadline}`);
  console.log(`  NOTE: ${l.schedule_note}`);
  console.log(`  PAY: ${l.pay} [${l.union_status}]`);
  console.log(`  SUB: ${l.submission_requirements}`);
  (l._roles||[]).forEach(r=>console.log(`   - ${r.name} (${r.role_type}, ${r.gender}, ${r.age_range}, ${r.pay}, ${r.est_days}d): ${r.description}`));
});
