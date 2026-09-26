// Loads the ACG generator straight out of swipecast-full.jsx so the harness
// always tests the code that ships. No copy, no transpile: the ACG block is
// plain JS.
const fs=require("fs");const path=require("path");const vm=require("vm");
const SRC=process.env.ACG_SRC||path.join(__dirname,"..","..","swipecast-full.jsx");
function grabFunction(src,name){
  const i=src.indexOf("function "+name+"(");
  if(i<0)throw new Error("missing "+name);
  let d=0,j=src.indexOf("{",i);
  for(;j<src.length;j++){if(src[j]==="{")d++;else if(src[j]==="}"){d--;if(!d)break;}}
  return src.slice(i,j+1);
}
function loadACG(){
  const src=fs.readFileSync(SRC,"utf8");
  const a=src.indexOf("const ACG = (()=>{");
  const b=src.indexOf("\n})();",a);
  if(a<0||b<0)throw new Error("ACG block not found");
  const block=src.slice(a,b+6);
  const store=new Map();
  const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()};
  // Seeded Math.random (ACG_SEED) so before/after runs are comparable.
  let seed=parseInt(process.env.ACG_SEED||"0",10)>>>0;
  const M=Object.create(Math);
  if(seed){M.random=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  const ctx={console,localStorage,Math:M,Date,JSON,Set,Map,Array,Object,String,Number,RegExp,Error,isFinite,parseInt,parseFloat,Intl};
  ctx.window=ctx;
  vm.createContext(ctx);
  // Round 9: role ordering lives outside the ACG block but the generator sorts
  // with it, so the harness needs the same single source of truth.
  const rankConst=(src.match(/const ROLE_TYPE_RANK=\{[^}]*\};/)||[""])[0];
  vm.runInContext(rankConst+"\n"+grabFunction(src,"roleTypeRank")+"\n"+grabFunction(src,"roleDays")+"\n"+grabFunction(src,"compareRoles")+"\n"+grabFunction(src,"fmtShootDay")+"\n"+grabFunction(src,"parseRoleRate")+"\n"+(src.indexOf("function castingDateProblems(")>-1?grabFunction(src,"castingDateProblems")+"\n":"")+block.replace("const ACG =","var ACG =")+"\nthis.ACG=ACG;",ctx,{filename:"acg-block.js"});
  return {ACG:ctx.ACG,ctx,store,parseRoleRate:ctx.parseRoleRate,src};
}
module.exports={loadACG};
