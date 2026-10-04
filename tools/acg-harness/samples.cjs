#!/usr/bin/env node
// Round 10: print rejected drafts whose problems match a pattern.
//   node tools/acg-harness/samples.cjs --grep relationship [--n 60] [--preused 6] [--max 5]
const {loadACG}=require("./load.cjs");
const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf(k);return i>-1?args[i+1]:d;};
const N=+arg("--n","60"),G=new RegExp(arg("--grep","."),"i"),MAX=+arg("--max","5");
const {ACG,store,ctx}=loadACG();
const seen=[];
if(args.includes("--preused")){const keep=+arg("--preused","6")||6;require("./dump-seeds.cjs").slice(keep).forEach(sd=>seen.push({key:"seed "+sd.k.replace(/[^a-z0-9]+/g," ").trim(),kind:"story"}));}
const listings=[];let shown=0,rounds=0;
while(listings.length<N&&rounds<N&&shown<MAX){
  rounds++;store.clear();ctx.__acgShiftDays=(rounds-1)*3;
  const batch=ACG.generateBatch("admin",listings,5,seen.slice());
  (ctx.__acgLastRun.rejectLog||[]).forEach(x=>{if(shown>=MAX)return;const p=x.problems.filter(q=>G.test(q));if(!p.length)return;shown++;
    console.log("──",x.type,"|",p.join(" ; "));console.log("SYN:",x.synopsis);x.roles.forEach(r=>console.log("  -",r.slice(0,400)));});
  batch.forEach(raw=>{listings.push({...raw,roles:raw._roles});ACG.seenRowsFor(raw).forEach(r=>seen.push(r));});
  if(!batch.length)break;
}
