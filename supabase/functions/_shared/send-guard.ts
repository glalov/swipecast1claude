// Universal repeat-send guard (2026-10-04).
//
// Every automated sender claims each address in public.email_send_ledger BEFORE
// sending. The database refuses a claim when the same address already has the
// same kind+ref inside the window, so even if a sender's own "already sent"
// bookkeeping breaks (as agd-intro's did on 2026-10-04, re-mailing the same 15
// people every 15 minutes), nobody can be mailed twice.
//
// Fails CLOSED: if the claim call itself errors, claimSends returns null and the
// caller must send nothing this run.

// deno-lint-ignore no-explicit-any
type Sb = any;

/** Returns the lowercase addresses that may be sent now, or null = send nothing. */
export async function claimSends(sb: Sb, kind: string, emails: string[], window: string, ref = ""): Promise<Set<string> | null> {
  const list = emails.filter(Boolean);
  if (!list.length) return new Set();
  const { data, error } = await sb.rpc("claim_email_sends", { p_kind: kind, p_emails: list, p_window: window, p_ref: ref });
  if (error) { console.error(`[send-guard] claim ${kind} failed, sending nothing:`, error.message); return null; }
  return new Set(((data as string[]) || []).map((e) => String(e).toLowerCase()));
}

/** Gives claims back for addresses whose send failed, so a later run can retry. */
export async function releaseSends(sb: Sb, kind: string, emails: string[], ref = ""): Promise<void> {
  const list = emails.filter(Boolean);
  if (!list.length) return;
  const { error } = await sb.rpc("release_email_sends", { p_kind: kind, p_emails: list, p_ref: ref });
  if (error) console.error(`[send-guard] release ${kind} failed:`, error.message);
}
