// process-digest-queue — Supabase Edge Function
// Orchestrates the DAILY casting digest for ALL eligible talent users.
//
// POST { action: "run" }   → match + send digests to every eligible user.
// POST { action: "test", to_email } → preview send.
// GET  ?action=unsubscribe&uid=<id> → unsubscribe + redirect to confirmation.
//
// Reliability notes:
//   • Users are paginated (no 1000-row cap) so OLDER users are never dropped.
//   • A user gets the digest whenever they have >= 1 NEW matching casting they
//     haven't been emailed before — NOT a fixed "5 new" threshold. This is the
//     fix for digests silently stopping for older users once the initial pool
//     of castings had all been sent. digest_min_projects is now the MAX number
//     of cards per email (cap), not a send-gate.
//   • Every user outcome (sent/skipped/failed) is written to email_digest_logs
//     with the recipient email + a human reason, so admins can audit who got
//     what and why.
//   • Each user is isolated in try/catch — one failure never stops the run.
//   • De-dup via user_casting_email_history keeps users from getting the same
//     casting twice, while still letting tomorrow's new castings go out.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
};

function eligible(freq: string, lastSent: string|null): boolean {
  if(freq==="off") return false;
  if(!lastSent) return true;
  const h=(Date.now()-new Date(lastSent).getTime())/3600000;
  return freq==="daily"?h>=20:freq==="every_other_day"?h>=44:freq==="weekly"?h>=164:false;
}

function matches(prefs: any, c: any): boolean {
  const loc=(c.location||"").toLowerCase();
  const open=!loc||loc.includes("nationwide")||loc.includes("remote")||loc.includes("worldwide")||loc.includes("any");
  const cities=((prefs.preferred_cities)||[]).filter(Boolean);
  if(!open&&cities.length>0){
    if(!cities.some((city:string)=>{ const cl=city.toLowerCase().trim(); return loc.includes(cl)||cl.includes(loc.split(",")[0].trim()); })) return false;
  }
  const up=((prefs.union_preference)||"any").toLowerCase();
  if(up!=="any"){
    const cu=(c.union_status||"").toLowerCase();
    const isU=cu.includes("sag")||cu.includes("aea")||cu.includes("union");
    const nonU=cu.includes("non-union")||cu.includes("non union");
    if(up==="union"&&!isU) return false;
    if(up==="non_union"&&isU&&!nonU) return false;
  }
  const types=((prefs.preferred_project_types)||[]).filter(Boolean);
  if(types.length>0){
    const ct=(c.type||"").toLowerCase();
    if(!types.some((t:string)=>{ const tl=t.toLowerCase(); return ct.includes(tl)||tl.includes(ct); })) return false;
  }
  if(prefs.paid_only&&!c.pay) return false;
  return true;
}

serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});

  // Unsubscribe via GET — update DB then redirect to the SPA confirmation page
  if(req.method==="GET"){
    const url=new URL(req.url);
    if(url.searchParams.get("action")==="unsubscribe"&&url.searchParams.get("uid")){
      const uid=url.searchParams.get("uid")!;
      const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);
      await sb.from("email_preferences").upsert(
        {user_id:uid,casting_digest_enabled:false,unsubscribed_at:new Date().toISOString(),updated_at:new Date().toISOString()},
        {onConflict:"user_id"}
      );
      return new Response(null,{ status:302, headers:{"Location":`${APP_URL}/unsubscribed`} });
    }
    return new Response("Not found",{status:404});
  }

  const res=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});

  try{
    const body=await req.json();
    const{action,to_email}=body;
    const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);

    // Non-fatal logging helper — a logging failure must never abort the run.
    const logRow=async(row:Record<string,unknown>)=>{
      try{ await sb.from("email_digest_logs").insert(row); }catch(e){ console.error("[digest-queue] log insert failed",e); }
    };

    if(action==="test"){
      if(!to_email) return res({error:"to_email required"},400);
      const{data:cs}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at").eq("status","open").eq("published",true).order("created_at",{ascending:false}).limit(5);
      const preview=(cs||[]).map((c:any)=>({...c,posted_at:c.created_at,roles:[]}));
      if(!preview.length) preview.push({id:"preview",title:"Indie Feature — New York",type:"Film",location:"New York, NY",union_status:"SAG-AFTRA",pay:"$2,500/week",synopsis:"A quiet drama about a Brooklyn ceramicist navigating her first gallery show. Character-driven, single-location, real-world cast.",slug:"sample",posted_at:new Date().toISOString(),roles:[{name:"NADIA",age_range:"28–38",gender:"Female",pay:"$2,500/week"}]});
      const{data:r,error:e}=await sb.functions.invoke("send-digest-email",{body:{to_email,castings:preview,is_test:true}});
      if(e) return res({error:e.message},500);
      return res({ok:true,result:r});
    }

    if(action==="run"){
      const{data:cfg}=await sb.from("site_settings").select("digest_emails_enabled,digest_min_projects,digest_paused").eq("id",1).maybeSingle();
      if(!cfg?.digest_emails_enabled||cfg.digest_paused) return res({ok:false,message:cfg?.digest_paused?"Paused":"Disabled",sent:0,skipped:0});
      // Max castings per email (cap). NOT a send-gate — a single new match still sends.
      const cap=Math.max(1,(cfg.digest_min_projects as number)||5);

      // ── Load ALL active, visible talent profiles (paginated — no 1000 cap) ───
      const profiles:any[]=[];
      {
        const PAGE=1000; let from=0;
        while(true){
          const{data,error}=await sb.from("profiles")
            .select("id,display_name,notification_email")
            .in("user_type",["talent","actor"])
            .eq("account_status","active")
            .eq("visible",true)
            .order("created_at",{ascending:true})
            .range(from,from+PAGE-1);
          if(error){ console.error("[digest-queue] profiles page error",error); break; }
          if(!data?.length) break;
          profiles.push(...data);
          if(data.length<PAGE) break;
          from+=PAGE;
        }
      }
      if(!profiles.length) return res({ok:true,message:"No eligible users",sent:0,skipped:0});

      const uids=profiles.map((p:any)=>p.id);

      // ── Email preferences for those users ───────────────────────────────────
      const pm:Record<string,any>={};
      {
        const CH=300;
        for(let i=0;i<uids.length;i+=CH){
          const{data:prefs}=await sb.from("email_preferences").select("*").in("user_id",uids.slice(i,i+CH));
          (prefs||[]).forEach((p:any)=>{pm[p.user_id]=p;});
        }
      }

      // ── Recipient emails (paginated admin list) — for logging + validity ─────
      const emailMap:Record<string,string>={};
      {
        let page=1;
        while(page<=200){
          const{data,error}=await sb.auth.admin.listUsers({page,perPage:1000});
          if(error){ console.error("[digest-queue] listUsers error",error); break; }
          const us=(data?.users||[]) as any[];
          if(us.length===0) break; // paginate until empty regardless of effective page size
          us.forEach(u=>{ if(u?.id&&u?.email) emailMap[u.id]=u.email; });
          page++;
        }
      }

      // ── All open published castings (recent first) + their roles ─────────────
      const{data:castings}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at").eq("status","open").eq("published",true).order("created_at",{ascending:false}).limit(500);
      if(!castings?.length) return res({ok:true,message:"No active castings",sent:0,skipped:0});
      const cids=castings.map((c:any)=>c.id);
      const rb:Record<string,any[]>={};
      {
        const CH=200;
        for(let i=0;i<cids.length;i+=CH){
          const{data:roles}=await sb.from("roles").select("id,casting_id,name,age_range,gender,pay").in("casting_id",cids.slice(i,i+CH));
          (roles||[]).forEach((r:any)=>{if(!rb[r.casting_id])rb[r.casting_id]=[];rb[r.casting_id].push(r);});
        }
      }
      const cwr=castings.map((c:any)=>({...c,posted_at:c.created_at,roles:rb[c.id]||[]}));

      let sent=0, skipped=0, failed=0;
      const skipReasons:Record<string,number>={};
      const errs:string[]=[];
      const bump=(reason:string)=>{ skipReasons[reason]=(skipReasons[reason]||0)+1; };

      for(const p of profiles){
        const email=emailMap[p.id]||null;
        try{
          const pf=pm[p.id]??{};

          // ── Eligibility gates (with explicit reasons) ───────────────────────
          let skipReason:string|null=null;
          if(pf.casting_digest_enabled===false)      skipReason="digest_disabled";
          else if(pf.unsubscribed_at)                skipReason="unsubscribed";
          else if(p.notification_email===false)      skipReason="email_notifications_off";
          else if((pf.frequency||"daily")==="off")   skipReason="frequency_off";
          else if(!eligible(pf.frequency||"daily",pf.last_sent_at??null)) skipReason="sent_recently";
          // NOTE: we do NOT skip on a missing emailMap entry — send-digest-email
          // resolves the address itself via getUserById. The map is logging-only.

          if(skipReason){ skipped++; bump(skipReason); await logRow({user_id:p.id,email,status:"skipped",reason:skipReason,project_ids_included:[]}); continue; }

          // ── New (not-yet-emailed) matching castings ─────────────────────────
          let sentIds=new Set<string>();
          try{
            const{data:hist}=await sb.from("user_casting_email_history").select("casting_id").eq("user_id",p.id);
            sentIds=new Set((hist||[]).map((h:any)=>h.casting_id));
          }catch(e){ console.error("[digest-queue] history fetch failed",p.id,e); }

          const m=cwr.filter((c:any)=>!sentIds.has(c.id)&&matches(pf,c));
          if(m.length<1){ skipped++; bump("no_new_matches"); await logRow({user_id:p.id,email,status:"skipped",reason:"no_new_matches",project_ids_included:[]}); continue; }

          // ── Send (cap cards). send-digest-email writes the sent/failed log,
          //    history rows, and last_sent_at. We only log transport failures. ──
          const batch=m.slice(0,cap);
          const{error:ie}=await sb.functions.invoke("send-digest-email",{body:{user_id:p.id,castings:batch,is_test:false}});
          if(ie){ failed++; errs.push(`${p.id}: ${ie.message}`); await logRow({user_id:p.id,email,status:"failed",reason:"invoke_error",error_message:ie.message,project_ids_included:batch.map((c:any)=>c.id)}); }
          else sent++;
        }catch(e){
          failed++; errs.push(`${p.id}: ${String(e)}`);
          await logRow({user_id:p.id,email,status:"failed",reason:"unexpected_error",error_message:String(e),project_ids_included:[]});
        }
        // Respect Resend rate limits
        await new Promise(r=>setTimeout(r,120));
      }

      const summary={ok:true,sent,skipped,failed,total_users:profiles.length,skip_reasons:skipReasons,errors:errs.length?errs.slice(0,50):undefined};
      console.log("[digest-queue] run complete",JSON.stringify(summary));
      return res(summary);
    }

    return res({error:"Unknown action"},400);
  }catch(e){
    console.error("[digest-queue]",e);
    return res({error:String(e)},500);
  }
});
