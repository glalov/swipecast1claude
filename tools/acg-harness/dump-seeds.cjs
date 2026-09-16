const fs=require("fs"),vm=require("vm"),path=require("path");
const src=fs.readFileSync(path.join(__dirname,"../../swipecast-full.jsx"),"utf8");
const a=src.indexOf("  const FILM_SEEDS=[");const b=src.indexOf("\n  ];",a);
const seeds=Function("return "+src.slice(a+"  const FILM_SEEDS=".length,b+4))();
module.exports=seeds;
if(require.main===module)seeds.forEach((s,i)=>console.log(i,s.k,"|",(s.tracks||[]).join(","),"|",s.genre,"|",s.only?("ONLY "+s.only.join("/")):"","|",s.p));
