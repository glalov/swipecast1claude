// Role-gender matching for EMAILS (2026-10-08).
//
// A port of the site's rules (normRoleGender / defaultOpenToRoleGenders /
// effectiveOpenTo / roleGenderAllowed in swipecast-full.jsx). Keep the two in
// step. The upsell used to ignore gender entirely, so women were mailed
// all-male castings and every card led with whichever role the database
// returned first ("i am a female!" reply, 2026-10-08).
//
// Rules that must not break:
//  • Roles open to all genders are shown to EVERYONE, always.
//  • Unknown role wording counts as "any" — bad data must never hide a role.
//  • profiles.open_to_role_genders is what we match on (a DB trigger keeps it in
//    sync with authentic_genders). NULL = never set → derive from gender.
//  • Actors we cannot classify (no gender, nothing picked) are NOT filtered by
//    gender, but castings whose every role is for one single gender are left out
//    and the card leads with an all-genders role when the casting has one.

// deno-lint-ignore-file no-explicit-any
export const ROLE_GENDERS = ["Male", "Female", "Non-Binary"];

export function normRoleGender(g: unknown): string {
  const v = String(g ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (!v || v === "any" || v === "all genders" || v === "all" || v === "open" || v === "any gender") return "any";
  if (v === "male" || v === "man" || v === "men") return "male";
  if (v === "female" || v === "woman" || v === "women") return "female";
  if (v === "non binary" || v === "nonbinary" || v === "enby") return "non-binary";
  return "any";
}

// null = we can't tell from the identity (empty, Genderfluid, custom, …).
function identityOpenTo(gender: unknown): string[] | null {
  const v = String(gender ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (v === "male" || v === "trans man" || v === "man male" || v === "ftm") return ["Male"];
  if (v === "female" || v === "trans woman" || v === "woman female" || v === "mtf") return ["Female"];
  if (v === "non binary") return ["Non-Binary"];
  return null;
}

export interface GenderFit { openTo: string[]; known: boolean; }

/** What this actor should be shown, and whether we actually know it. */
export function genderFit(p: any): GenderFit {
  const stored = p?.open_to_role_genders;
  if (Array.isArray(stored)) return { openTo: stored.filter((g: string) => ROLE_GENDERS.includes(g)), known: true };
  const fromId = identityOpenTo(p?.gender);
  if (fromId) return { openTo: fromId, known: true };
  // Unclassifiable → the site shows them every role; so do we, minus the
  // single-gender castings (see castingFitsGender).
  return { openTo: ROLE_GENDERS.slice(), known: false };
}

export function roleAllowed(roleGender: unknown, fit: GenderFit): boolean {
  const rg = normRoleGender(roleGender);
  if (rg === "any") return true;
  return fit.openTo.map(normRoleGender).includes(rg);
}

/** Keep the casting only if this actor can play at least one of its roles. */
export function castingFitsGender(c: any, fit: GenderFit): boolean {
  const roles: any[] = c?.roles || [];
  if (!roles.length) return true;                       // no role rows → can't judge, keep
  if (fit.known) return roles.some((r) => roleAllowed(r.gender, fit));
  const g = new Set(roles.map((r) => normRoleGender(r.gender)));
  return !(g.size === 1 && !g.has("any"));              // drop all-male / all-female castings
}

/**
 * Same casting, roles reordered so the card's headline role (roles[0]) is one
 * this actor can play: their own gender first, then all-genders roles. For an
 * unknown actor, all-genders roles lead. Never drops a role — "+N more" stays honest.
 */
export function withLeadRole(c: any, fit: GenderFit): any {
  const roles: any[] = c?.roles || [];
  if (roles.length < 2) return c;
  const rank = (r: any): number => {
    const rg = normRoleGender(r.gender);
    if (!fit.known) return rg === "any" ? 0 : 1;
    if (rg === "any") return 1;
    return roleAllowed(r.gender, fit) ? 0 : 2;
  };
  const sorted = roles.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
  // Unknown actor and no all-genders role to lead with: featuring any one
  // gendered role guesses at who they are. The card shows a neutral summary
  // instead ("2 roles · Female & Male") — see roleSummary().
  if (!fit.known && normRoleGender(sorted[0].gender) !== "any") return { ...c, roles: sorted, _neutralLead: true };
  return { ...c, roles: sorted };
}

/** "3 roles · Female & Male" — for cards flagged _neutralLead. */
export function roleSummary(c: any): string {
  const roles: any[] = c?.roles || [];
  const label: Record<string, string> = { female: "Female", male: "Male", "non-binary": "Non-Binary", any: "All genders" };
  const order = ["female", "male", "non-binary", "any"];
  const seen = order.filter((g) => roles.some((r) => normRoleGender(r.gender) === g)).map((g) => label[g]);
  const list = seen.length > 1 ? `${seen.slice(0, -1).join(", ")} & ${seen[seen.length - 1]}` : (seen[0] || "");
  return `${roles.length} role${roles.length === 1 ? "" : "s"}${list ? ` · ${list}` : ""}`;
}

// ── Personal "Tell us which roles to show you" link ─────────────────────────
// HMAC-SHA256(uid) with app_secrets.roles_link_secret. The set-roles function
// checks the same signature, so the link works without a login but only for
// the person it was mailed to, and only for this one setting.
export async function rolesLinkToken(secret: string, uid: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`set-roles:${uid}`)));
  let s = ""; sig.forEach((b) => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}

export async function loadRolesLinkSecret(sb: any): Promise<string | null> {
  try {
    const { data } = await sb.from("app_secrets").select("value").eq("key", "roles_link_secret").maybeSingle();
    return data?.value || null;
  } catch (_) { return null; }
}
