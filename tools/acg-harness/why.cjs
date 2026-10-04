#!/usr/bin/env node
// Round 10: full rejection histogram, by reason and by type.
//   node tools/acg-harness/why.cjs [--n 100] [--batch 5] [--preused 6] [--grep r10]
const {loadACG}=require("./load.cjs");
const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf(k);return i>-1?args[i+1]:d;};
const N=+arg("--n","100"),B=+arg("--batch","5"),G=arg("--grep",null);
const {ACG,store,ctx}=loadACG();
const seen=[];
if(args.includes("--preused")){const keep=+arg("--preused","6")||6;require("./dump-seeds.cjs").slice(keep).forEach(sd=>seen.push({key:"seed "+sd.k.replace(/[^a-z0-9]+/g," ").trim(),kind:"story"}));}
const listings=[];const WHY={},BYTYPE={},EX={};let rounds=0;
while(listings.length<N&&rounds<N){
  rounds++;store.clear();ctx.__acgShiftDays=(rounds-1)*3;
  const batch=ACG.generateBatch("admin",listings,Math.min(B,N-listings.length),seen.slice());
  const lr=ctx.__acgLastRun;
  Object.entries(lr.why||{}).forEach(([k,v])=>{WHY["build: "+k]=(WHY["build: "+k]||0)+v;});
  (lr.rejectLog||[]).forEach(x=>x.problems.forEach(p=>{const k=p.replace(/: .*$/,m=>/^r10|^r8/.test(p)?m.slice(0,60):"");WHY[k]=(WHY[k]||0)+1;BYTYPE[x.type]=(BYTYPE[x.type]||0)+1;if(!EX[k])EX[k]=p;}));
  batch.forEach(raw=>{listings.push({...raw,roles:raw._roles});ACG.seenRowsFor(raw).forEach(r=>seen.push(r));});
  if(!batch.length)break;
}
console.log("made",listings.length);
const ent=Object.entries(WHY).filter(([k])=>!G||k.indexOf(G)>-1).sort((a,b)=>b[1]-a[1]);
ent.slice(0,60).forEach(([k,v])=>console.log(String(v).padStart(5),k,"|",String(EX[k]||"").slice(0,140)));
console.log("rejects by type",JSON.stringify(Object.entries(BYTYPE).sort((a,b)=>b[1]-a[1])));
