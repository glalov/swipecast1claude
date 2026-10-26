// phone-upload: the phone side of "Upload from your phone". No login on the phone: the one-off token from
// the desktop QR code is the key. GET ?token= checks it; POST (multipart: token, file) stores one photo in
// talent-media/<user>/phone-upload/ and records it so the desktop page can show it.
// Deployed with verify_jwt=false (the token is the auth). Table + RPC: migration phone_upload_sessions.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://www.castslate.com", "https://castslate.com"];
const MAX_FILES = 12;
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) || o.startsWith("http://127.0.0.1") || o.startsWith("http://localhost") ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let token = "";
  let form: FormData | null = null;
  if (req.method === "GET") token = new URL(req.url).searchParams.get("token") || "";
  else if (req.method === "POST") {
    try { form = await req.formData(); } catch { return json(req, 400, { error: "bad_request" }); }
    token = String(form.get("token") || "");
  } else return json(req, 405, { error: "method" });
  if (!/^[a-f0-9]{64}$/.test(token)) return json(req, 404, { error: "invalid" });

  const { data: s } = await sb.from("phone_upload_sessions").select("id,user_id,expires_at,upload_count").eq("token", token).maybeSingle();
  if (!s) return json(req, 404, { error: "invalid" });
  if (new Date(s.expires_at).getTime() < Date.now()) return json(req, 410, { error: "expired" });
  const remaining = Math.max(0, MAX_FILES - s.upload_count);
  if (req.method === "GET") return json(req, 200, { ok: true, expires_at: s.expires_at, remaining });

  if (remaining <= 0) return json(req, 429, { error: "limit" });
  const file = form!.get("file");
  if (!(file instanceof File)) return json(req, 400, { error: "no_file" });
  const ext = TYPES[file.type];
  if (!ext) return json(req, 415, { error: "type" });
  if (file.size > MAX_BYTES) return json(req, 413, { error: "too_large" });

  const path = `${s.user_id}/phone-upload/${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from("talent-media").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return json(req, 500, { error: "storage" });
  const url = sb.storage.from("talent-media").getPublicUrl(path).data.publicUrl;
  const ins = await sb.from("phone_upload_files").insert({ session_id: s.id, user_id: s.user_id, path, url }).select("id").single();
  if (ins.error) return json(req, 500, { error: "record" });
  await sb.from("phone_upload_sessions").update({ upload_count: s.upload_count + 1 }).eq("id", s.id);
  return json(req, 200, { ok: true, url, remaining: remaining - 1 });
});
