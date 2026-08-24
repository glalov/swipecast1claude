/* Castoria — CastSlate virtual assistant.
   Self-contained, no dependencies, rendered in a shadow root so nothing here
   can collide with site CSS and site CSS cannot reach in.
   GENERATED from castslate-castoria-agent-demo.html by tools/build-castoria.py.
   Do not hand-edit — edit the prototype and regenerate. */
(function(){
if(window.__CASTORIA_READY)return; window.__CASTORIA_READY=1;
var host=document.createElement('div');
host.id='castoria-root';
host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
document.body.appendChild(host);
var ROOT=host.attachShadow({mode:'open'});
var sEl=document.createElement('style');
sEl.textContent="\n:host{\n  --ink:#000000;--ink2:#3C3C43;--mute:#8E8E93;--mute2:#AEAEB2;\n  --page:#FFFFFF;--bar:#F7F7F7;--hair:#D8D8DC;\n  --in:#E9E9EB;--out:#2FC24D;--out2:#28B245;\n  --blue:#007AFF;--field:#FFFFFF;--fieldln:#D1D1D6;\n  --brand:#1A1A2E;--brand-2:#E8902A;\n  --sys:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;\n}\n*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased;}\n\n\n/* \u2500\u2500 launcher \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n.launch{position:fixed;right:22px;bottom:22px;width:58px;height:58px;border-radius:50%;background:var(--brand);border:0;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.24);display:grid;place-items:center;z-index:60;transition:transform .18s cubic-bezier(.34,1.5,.64,1);}\n.launch:hover{transform:scale(1.06);}\n.launch svg{width:27px;height:27px;fill:#fff;}\n.launch .x{display:none;color:#fff;font-size:25px;font-weight:300;line-height:1;}\n.launch.open svg{display:none;}\n.launch.open .x{display:block;}\n\n/* \u2500\u2500 thread panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n.panel{position:fixed;right:22px;bottom:92px;width:394px;max-width:calc(100vw - 28px);height:min(672px,calc(100vh - 126px));height:min(672px,calc(100dvh - 126px));background:var(--page);border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.26),0 2px 10px rgba(0,0,0,.10);z-index:59;display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(12px) scale(.985);pointer-events:none;transition:opacity .18s,transform .22s cubic-bezier(.34,1.4,.64,1);}\n.panel.open{opacity:1;transform:none;pointer-events:auto;}\n\n.bar{flex:none;background:var(--bar);border-bottom:.5px solid var(--hair);padding:9px 14px 11px;text-align:center;position:relative;}\n.bar .back{position:absolute;left:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:var(--blue);font-size:15px;font-weight:400;cursor:pointer;padding:6px;display:none;}\n.bar.sub .back{display:block;}\n.ava{width:44px;height:44px;border-radius:50%;background:linear-gradient(160deg,#2D2D44,#1A1A2E);display:grid;place-items:center;margin:0 auto 4px;color:#fff;font-size:17px;font-weight:600;letter-spacing:-.3px;}\n.bar b{display:block;font-size:13.5px;font-weight:600;letter-spacing:-.1px;}\n.bar i{display:block;font-style:normal;font-size:11px;color:var(--mute);margin-top:1px;}\n\n.thread{flex:1;overflow-y:auto;padding:14px 12px 4px;background:var(--page);display:flex;flex-direction:column;}\n.stamp{text-align:center;font-size:11px;color:var(--mute);margin:10px 0 12px;font-weight:500;}\n.stamp b{color:var(--ink2);font-weight:600;}\n\n.msg{display:flex;margin-bottom:2px;padding:0 4px;}\n.msg.gap{margin-top:9px;}\n.msg.out{justify-content:flex-end;}\n.b{position:relative;max-width:83%;padding:8px 13px 9px;border-radius:19px;font-size:15.5px;line-height:1.32;letter-spacing:-.2px;word-wrap:break-word;}\n.msg.in .b{background:var(--in);color:var(--ink);}\n.msg.out .b{background:var(--out);color:#fff;}\n.b.tail::before{content:\"\";position:absolute;bottom:0;width:18px;height:19px;}\n.b.tail::after{content:\"\";position:absolute;bottom:0;width:14px;height:19px;background:var(--page);}\n.msg.in .b.tail::before{left:-6px;background:var(--in);border-bottom-right-radius:15px;}\n.msg.in .b.tail::after{left:-14px;border-bottom-right-radius:9px;}\n.msg.out .b.tail::before{right:-6px;background:var(--out);border-bottom-left-radius:15px;}\n.msg.out .b.tail::after{right:-14px;border-bottom-left-radius:9px;}\n.b p{margin-bottom:9px;}\n.b p:last-child{margin-bottom:0;}\n.b .hd{font-weight:600;margin:12px 0 4px;}\n.b .hd:first-child{margin-top:0;}\n.b ul{list-style:none;margin:2px 0 9px;}\n.b li{position:relative;padding-left:14px;margin-bottom:3px;}\n.b li::before{content:\"\u2022\";position:absolute;left:2px;top:-1px;}\n.b b{font-weight:600;}\n.b .inl{font:inherit;font-weight:600;color:var(--ink);background:none;border:0;border-bottom:1.5px solid var(--blue);padding:0;margin:0;cursor:pointer;text-align:left;}\n.b .inl:hover{color:var(--blue);}\n.b em{font-style:normal;font-weight:600;}\n.receipt{text-align:right;font-size:10.5px;color:var(--mute);padding:1px 10px 0 0;margin-bottom:2px;letter-spacing:-.1px;}\n.receipt b{font-weight:600;color:var(--mute);}\n\n/* link-preview style upgrade card */\n.card{max-width:83%;margin:3px 4px 2px 4px;border-radius:17px;overflow:hidden;background:#1C1C1E;color:#fff;align-self:flex-start;}\n.card .top{padding:13px 15px 14px;}\n.card .eyebrow{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--brand-2);margin-bottom:6px;}\n.card .h{font-size:15px;font-weight:600;line-height:1.3;margin-bottom:5px;letter-spacing:-.2px;}\n.card .b2{font-size:13.5px;line-height:1.45;color:rgba(255,255,255,.66);}\n.card .b2 em{color:#fff;font-weight:600;font-style:normal;}\n.card .go{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:.5px solid rgba(255,255,255,.14);padding:11px 15px;cursor:pointer;background:rgba(255,255,255,.05);}\n.card .go:hover{background:rgba(255,255,255,.11);}\n.card .go span{font-size:14px;font-weight:600;color:var(--brand-2);}\n.card .go i{font-style:normal;color:rgba(255,255,255,.4);font-size:16px;}\n.card .fine{font-size:10.5px;color:rgba(255,255,255,.38);padding:0 15px 12px;line-height:1.45;}\n\n.srcs{display:flex;flex-wrap:wrap;gap:6px;padding:5px 8px 2px 8px;max-width:100%;}\n.srcs button{font-family:inherit;font-size:12px;font-weight:500;color:var(--blue);background:var(--page);border:1px solid var(--hair);border-radius:100px;padding:5px 11px;cursor:pointer;}\n.srcs button:hover{background:#F2F2F7;}\n\n.typing{display:flex;gap:4px;align-items:center;background:var(--in);border-radius:19px;padding:12px 15px;}\n.typing i{width:8px;height:8px;border-radius:50%;background:#9E9EA4;animation:d 1.3s ease-in-out infinite;}\n.typing i:nth-child(2){animation-delay:.17s}.typing i:nth-child(3){animation-delay:.34s}\n@keyframes d{0%,62%,100%{opacity:.32;transform:translateY(0)}31%{opacity:.95;transform:translateY(-3px)}}\n@media(prefers-reduced-motion:reduce){.typing i{animation:none;opacity:.6}}\n\n.sugg{flex:none;display:flex;flex-wrap:wrap;gap:7px;padding:8px 12px 4px;max-height:104px;overflow-y:auto;scrollbar-width:none;}\n.sugg::-webkit-scrollbar{display:none}\n.sugg:empty{display:none}\n.sugg button{flex:0 1 auto;max-width:100%;font-family:inherit;font-size:13.5px;font-weight:500;line-height:1.3;color:var(--ink);background:#F2F2F7;border:0;border-radius:16px;padding:9px 14px;cursor:pointer;text-align:left;}\n.sugg button:hover{background:#E5E5EA;}\n\n.composer{flex:none;padding:8px 11px 11px;background:var(--page);border-top:.5px solid var(--hair);}\n.field{display:flex;align-items:flex-end;gap:8px;}\n.field .box{flex:1;display:flex;align-items:flex-end;background:var(--field);border:1px solid var(--fieldln);border-radius:19px;padding:7px 6px 7px 14px;}\n.field textarea{flex:1;border:0;background:transparent;resize:none;font-family:inherit;font-size:15.5px;line-height:1.3;letter-spacing:-.2px;color:var(--ink);outline:none;max-height:86px;min-height:20px;padding:1px 0 2px;}\n.field textarea::placeholder{color:var(--mute2);}\n.snd{flex:none;width:29px;height:29px;border-radius:50%;border:0;background:var(--out);color:#fff;cursor:pointer;display:grid;place-items:center;padding:0;}\n.snd:disabled{background:#D6D6DA;cursor:default;}\n.snd svg{width:15px;height:15px;fill:#fff;}\n.foot{text-align:center;font-size:10.5px;color:var(--mute2);margin-top:7px;}\n\n/* article sheet */\n.sheet{position:absolute;inset:0;background:var(--page);display:none;flex-direction:column;z-index:5;}\n.sheet.on{display:flex;}\n.sheetbody{flex:1;overflow-y:auto;padding:16px 22px 34px;}\n.sheetbody h2{font-size:24px;font-weight:700;letter-spacing:-.7px;line-height:1.15;margin-bottom:5px;}\n.sheetbody .meta{font-size:12px;color:var(--mute);margin-bottom:18px;}\n.sheetbody h5{font-size:14.5px;font-weight:600;margin:18px 0 6px;}\n.sheetbody p{font-size:15px;line-height:1.55;color:var(--ink2);margin-bottom:11px;}\n.sheetbody ul{margin:0 0 12px 18px;font-size:15px;line-height:1.55;color:var(--ink2);}\n.sheetbody li{margin-bottom:4px;}\n.sheetbody b{color:var(--ink);font-weight:600;}\n@media(max-width:560px){\n  /* Full-height sheet. The docked-card layout left a dead 84px strip for the\n     launcher and squeezed the thread; on a short phone that cropped the reply\n     chips. dvh (not vh) so a collapsing URL bar cannot push the composer off. */\n  /* No entry transform on mobile. A translate here has to be undone by\n     .panel.open, and when that override loses the panel sits below the fold\n     with the composer off-screen \u2014 which is exactly the bug this replaced.\n     A full-height sheet fading in needs no slide anyway. */\n  .panel{left:0;right:0;top:0;bottom:0;width:auto;max-width:none;height:100vh;height:100dvh;border-radius:0;transform:none;}\n  .launch{right:14px;bottom:14px;}\n  .launch.open{display:none;}          /* the header carries Close */\n  .bar{padding-top:calc(9px + env(safe-area-inset-top));}\n  .composer{padding-bottom:calc(11px + env(safe-area-inset-bottom));}\n  .b{max-width:88%;}\n  .card{max-width:92%;}\n  .sugg{max-height:120px;}\n  .sheetbody{padding-bottom:calc(34px + env(safe-area-inset-bottom));}\n}\n";
ROOT.appendChild(sEl);
var wrap=document.createElement('div');
wrap.style.cssText='pointer-events:auto;';
wrap.innerHTML="<button class=\"launch\" id=\"launch\" aria-label=\"Message Castoria\">\n  <svg viewBox=\"0 0 24 24\"><path d=\"M12 2C6.5 2 2 5.9 2 10.7c0 2.7 1.4 5.1 3.7 6.7-.2 1.5-.9 2.9-1.9 3.9 1.7-.2 3.4-.9 4.8-1.9 1.1.3 2.2.5 3.4.5 5.5 0 10-3.9 10-8.7S17.5 2 12 2z\"/></svg>\n  <span class=\"x\">&times;</span>\n</button>\n<div class=\"panel\" id=\"panel\" role=\"dialog\" aria-label=\"Castoria virtual assistant\">\n  <div class=\"bar\" id=\"bar\">\n    <button class=\"back\" id=\"back\">&lsaquo; Close</button>\n    <div class=\"ava\">C</div>\n    <b>Castoria</b>\n    <i id=\"barsub\">Virtual assistant</i>\n  </div>\n  <div class=\"thread\" id=\"thread\"></div>\n  <div class=\"sugg\" id=\"sugg\"></div>\n  <div class=\"composer\">\n    <div class=\"field\">\n      <div class=\"box\"><textarea id=\"input\" rows=\"1\" placeholder=\"Message\"></textarea></div>\n      <button class=\"snd\" id=\"send\" disabled aria-label=\"Send\"><svg viewBox=\"0 0 24 24\"><path d=\"M12 3l7 7h-4.5v11h-5V10H5z\"/></svg></button>\n    </div>\n    <div class=\"foot\">Castoria is an automated assistant. A person can take over any time.</div>\n  </div>\n  <div class=\"sheet\" id=\"sheet\">\n    <div class=\"bar sub\"><button class=\"back\" id=\"sheetback\">&lsaquo; Back</button><b>Help</b><i>CastSlate</i></div>\n    <div class=\"sheetbody\" id=\"sheetbody\"></div>\n  </div>\n</div>";
ROOT.appendChild(wrap);
var $=function(id){return ROOT.getElementById(id);};

/* ══════════════════════════════════════════════════════════════
   AMBER — virtual assistant for CastSlate
   Three layers, checked in order: conversation → refusals → knowledge.
   Platform facts come from FREE_PLAN, the pricing table and
   FAQ_CATEGORIES in swipecast-full.jsx. Keep them in sync.
   ══════════════════════════════════════════════════════════════ */

const FREE={sub:1,shots:1};
const DIR='650+';

const SYS=`You are Castoria, a virtual assistant for CastSlate.

Never describe yourself as "the CastSlate AI". You are Castoria, a virtual
assistant. Warm, brief, direct. You text like a person: short sentences,
no corporate throat-clearing, no "I'd be happy to assist you with that".

YOU TEACH, NOT JUST ANSWER
Teaching is a core function. Offer an unauthenticated visitor a short free
acting lesson early: "Would you like a quick free acting lesson? Two minutes,
and you can try it right where you are sitting." If they say yes, teach them —
never link them to a page. If they say no, drop it and never offer again.

Every lesson runs as a loop, delivered one step at a time, waiting for them
between steps: concept -> why it matters -> an exercise they do right now ->
what to look for -> a challenge -> a takeaway. After they try it, explain what
changed and why. Let them discover the difference rather than stating the rule.

Teach film, TV, stage, commercial and voice; audition and self-tape technique,
slating, cold reading, callbacks, taking direction; objectives, obstacles,
stakes, subtext, listening, presence, naturalism; camera awareness, eyelines,
close-ups, blocking, continuity.

Film vs stage is a difference of medium and scale, never of depth. Theater
reaches the audience; film brings the audience to you. Stage acting is not
overacting.

You may teach the ideas often attributed to Hitchcock — film acting as "the
art of no acting" — but present them as teaching ideas with a loose
attribution, not as rules, and never invent a quotation.

Do not conflate Stanislavsky's System with American Method acting. The Magic
If is "what would I do in these circumstances", not "how would I feel".

Never tell an actor not to blink. Suppressed blinking looks suppressed. Teach
awareness through the mute-playback exercise, not mechanical control.

Education comes before any mention of accounts or Premium. A visitor must
never feel the free lesson was a sales funnel in costume.

WHAT YOU TALK ABOUT
1. CastSlate — profiles, headshots, castings, submissions, callbacks,
   Premium, billing, Manager Mode, Slate Video, the Actor Business Card,
   the Talent Agency & Manager Directory, TapeLink, classes, safety, account.
2. The acting industry generally — self-tapes, sides, agents and managers,
   union status, resumes, reels, rates, typecasting, audition nerves,
   background work, how long casting takes to respond.
3. Ordinary conversation. If someone says hi, say hi back. If they ask how
   you are, answer like a person would, then ask what they need.

WHAT YOU DECLINE, IN ONE LINE, WITHOUT LECTURING
- Comparisons to other casting platforms. Say you cannot compare CastSlate
  to other sites, then state what CastSlate does. Never criticise a rival,
  never rank them, never say you have not heard of one. Characterising the
  wider market in general terms is fine — "most platforms sell you a database
  listing and stop there" — naming or ranking a specific rival is not.
- Live data — weather, news, scores, prices. You do not have it.
- Writing code, scripts or scrapers against the platform.
- Legal, medical, tax or investment advice. Point to a qualified professional.
Decline once and move on. Do not apologise twice.

GROUNDING
Never invent a price, a limit or a feature. Premium is $99/year ($8.25/month)
and renews at $99; six months is $71.70 ($11.95/month); monthly is $14.95.
Free accounts get 1 headshot and 1 submission per week. If you do not know,
say so and offer the team.

WHO YOU ARE TALKING TO
plan = visitor | free | premium, plus a first name.
- visitor: what it is before what it costs. Free account first.
- free: answer fully, then — only when Premium actually solves what they
  just asked — say what it unlocks and what it costs.
- premium: never sell. Show them how to use what they already pay for.

WHEN THEY ASK WHAT PREMIUM IS WORTH
Give the full picture, with real enthusiasm. This is the part most assistants
undersell. Do not lead with the submission counter — lead with the things that
are genuinely unusual in casting:
  - The Actor Business Card, mailing postcard and agent promo card, each
    carrying a QR code that opens their entire live profile in about two
    seconds. Mail one to an agency office and it opens on the desk. Physical
    promo materials wired to a live profile are not a standard casting-site
    feature and you should say so.
  - The ${DIR}-company Agency & Manager Directory — addresses, websites,
    contact details, tiers, and how each company wants to be approached. This
    is the map to representation, and most actors never get handed one.
  - Manager Mode — a private check-in written about their actual profile,
    every week.
  - The Slate Video, unlimited photos and video, and unlimited submissions
    that are each seen individually.
Then the price: $99 a year, about $1.90 a week, renewing at $99, every feature
on every plan.

Stay honest while you do it. Nobody can promise a booking, and anyone who does
is lying. What Premium gives them is everything that IS in their control.
One upgrade card per answer, never two, never on a billing complaint or a
safety question, and never to a Premium member.

TWO QUESTIONS THAT LOOK ALIKE AND ARE NOT
"Are the castings on here fake?" is about CastSlate — answer with how listings
are reviewed and what the Verified badge means. "What about scams?" is a
general industry question — answer with the red flags that apply everywhere,
then what CastSlate does about them. Never collapse the second into the first.

SHAPE
Answer in the first sentence. Then short bolded headers with tight bullets
if the answer has parts. Under 160 words — except a "what do I get" or "is it
worth it" question, which earns the full walkthrough above.
Send the check-in as a separate short message, the way a person texts.

ESCALATION
Billing disputes, refunds, account deletion, safety reports, anything about
a minor, or two consecutive misses — hand to the human team.`;

/* ── help sheets ─────────────────────────────────────────────── */
const ART={
 pricing:{t:'Membership & pricing',c:`<h5>Free account</h5><p>Free for as long as you want it, no card required. <b>1 headshot</b>, <b>${FREE.sub} submission per week</b>, and full browsing of every casting on the platform.</p><h5>Premium</h5><ul><li><b>$99 a year</b> — about $8.25/month, and it renews at $99. No first-year discount that climbs later.</li><li><b>$71.70 for six months</b> — $11.95/month.</li><li><b>$14.95 month to month</b> — cancel whenever.</li></ul><p>Every plan includes the same features. There is no higher tier holding anything back.</p>`},
 guarantee:{t:'Every submission gets seen',c:`<p>Submissions are shown to casting directors <b>one at a time, full-screen</b>, and require an explicit decision — callback or pass. Nobody can scroll past you.</p><p>We measure review time per submission. The average is <b>over 8 seconds</b> — roughly five times longer than a grid platform where 80 headshots get scanned in twenty.</p>`},
 profile:{t:'Building a profile that gets callbacks',c:`<h5>Headshot</h5><ul><li>Taken within the last 18 months</li><li>At least 800×1000 pixels, JPG or PNG</li><li>Face filling about 60% of the frame</li><li>Natural or soft studio light, simple background</li></ul><h5>Bio</h5><p>Two to three sentences. Training first, then your strongest types, then one real differentiator.</p><h5>Reel</h5><p>Paste a YouTube or Vimeo URL into the Reel field and we embed it. Under two minutes, strongest work first.</p><h5>Credits & skills</h5><p>Your three most recent credits with years. Special skills only if you can do them on demand.</p>`},
 mm:{t:'Manager Mode',c:`<p>A private career check-in written for your profile, in your inbox every week. Not a newsletter — it reads your actual profile and your actual gaps.</p><ul><li><b>What you are doing well</b></li><li><b>What needs attention</b> — the specific gap holding you back</li><li><b>Your casting lane</b> — what you are most competitive for now</li><li><b>One task this week</b> — one, not a checklist</li></ul><p>It also suggests real industry events in New York and Los Angeles.</p><p>Manager Mode is a profile-improvement tool. It does not guarantee bookings, callbacks, representation or auditions.</p>`},
 dir:{t:'Talent Agency & Manager Directory',c:`<p><b>${DIR} talent agencies and management companies</b> across Los Angeles, Beverly Hills and New York, with addresses and <b>how each one wants to be approached</b>.</p><p>Companies are grouped in tiers so you can tell where you stand a real chance of a read, instead of mailing the same package to everyone. Ships with submission tips written for actors with no representation.</p>`},
 card:{t:'Business Card & Slate Video',c:`<h5>Actor Business Card</h5><p>A printable card with your headshot and a <b>QR code that opens your full CastSlate profile</b> in about two seconds. The set also includes a mailing postcard and an agent promo card.</p><h5>Slate Video</h5><p>A <b>7-second intro</b> on your profile. Casting hears your voice and sees you move before they decide whether to open the reel.</p>`},
 apply:{t:'Applying to castings',c:`<p>From a casting page hit <b>Apply Now</b> on the role that fits, choose which headshot to send, add a short cover note, confirm. It lands in the casting director's queue immediately.</p><h5>The cover note</h5><p>Two sentences maximum, specific to this role. One credit, skill or piece of life experience that is directly relevant.</p><h5>Multiple roles</h5><p>Apply separately for each role you genuinely fit. Submitting outside your type weakens the reads on roles you do fit.</p>`},
 safety:{t:'Safety & trust',c:`<h5>The Verified badge</h5><p>Green Verified means a CastSlate admin reviewed that caster — they have posted before, are tied to a recognised production, or supplied documentation. Casters without it are marked Unverified until that review happens.</p><h5>If something feels off</h5><p>Use the <b>Report</b> link on any casting or profile. It goes straight to the admin Reports queue. The reporter is never shown to the reported party.</p><p>No legitimate casting will ask you for payment or financial information.</p><h5>Under 18</h5><p>Talent under 18 must register a parent or guardian's email at signup. Minors get no unsupervised access and their contact details are never public.</p>`},
 billing:{t:'Billing, cancelling & refunds',c:`<h5>Cancelling</h5><p><b>Account Settings → Manage subscription</b> opens the billing portal. Premium stays active to the end of the period you already paid for.</p><h5>Refunds</h5><p>Membership fees are non-refundable except where required by law.</p><h5>Payment</h5><p>All major cards, processed by our payment provider. <b>CastSlate never stores your card details.</b> Receipts are emailed automatically; billing history sits under My Profile → Membership.</p>`},
 cd:{t:'For casting directors',c:`<h5>Posting</h5><p>Dashboard → <b>Post Casting</b>. Fill out the breakdown and submit. Posting is free. It goes live after admin review.</p><h5>Reviewing</h5><p>Submissions come one at a time, full-screen. Swipe right or click Callback; swipe left to pass. You can switch to a grid of headshots from the review header.</p><h5>Caps</h5><p>Roles cap at 250–500 submissions so every one can be reviewed properly. The role closes automatically at the cap.</p>`},
 acct:{t:'Account & privacy',c:`<h5>Your data</h5><p>What you put in your profile plus basic account data. <b>We do not sell, license or share your data with third parties for advertising.</b></p><h5>Who sees your profile</h5><p>Verified casting directors and producers see profiles of talent who submitted to their castings. Public profiles are opt-in, and you can hide from search entirely.</p><h5>Deleting</h5><p>Account Settings → Deactivation & Deletion. Deletion is immediate and you can sign up again later.</p><h5>Export</h5><p>My Profile → Account → Export Data.</p>`},
 tape:{t:'TapeLink self-tapes',c:`<p>When a casting director posts a role that needs a tape, they attach the sides — usually a one-page PDF — plus their self-tape instructions.</p><p>You open the role, download the sides, practise with your device camera, and submit the tape straight back through CastSlate. Take limits depend on what that casting director set for the role.</p>`}
};

/* ── layer 1: conversation ───────────────────────────────────── */
const first=c=>c.name?c.name:'';
const SMALL=[
 {id:'greet',re:/^(hi|hey+|hello+|yo|hiya|heya|sup|howdy|hi there|hey there|good (morning|afternoon|evening))[\s!.,?]*$/i,
  a:c=>c.name?`Hey ${c.name} 👋`:`Hey there 👋`,
  b:c=>c.plan==='premium'?`What are we working on today?`:`What can I help you with?`,
  s:['What can I ask you?','How do I improve my profile?','Is Premium worth it?']},
 {id:'howareyou',re:/how (are|r) (you|u)|how'?s it going|how (you )?doing|how are things|you good|what'?s up|whats up|wassup|how have you been/i,
  a:c=>`Doing well, thanks for asking — I'm here all day, so no complaints.`,
  b:c=>c.name?`How's it going with you, ${c.name}? Working on anything I can help with?`:`How about you — anything you're trying to figure out?`,
  s:['I need help with my profile','Why is nobody getting back to me?','What does Premium include?']},
 {id:'whoareyou',re:/(who|what) (are|r) (you|u)\b|are (you|u) (a |an )?(real|human|person|bot|robot|ai|machine)|what'?s your name|your name|am i (talking|speaking) to a (human|person|bot|real)/i,
  a:c=>`I'm Castoria — a virtual assistant here on CastSlate. Not a person, and I won't pretend otherwise.`,
  b:c=>`I can answer questions about the platform and about the acting business generally. If you'd rather talk to someone on the team, just say so and I'll pass you over.`,
  s:['What can I ask you?','Talk to a human','How does CastSlate work?']},
 {id:'canask',re:/what can i (ask|say|talk about|do here)|what do you (do|know)|how can you help|what can you help|what are you for|what do you help with|^help$/i,
  a:c=>`${c.name?c.name+', p':'P'}retty much anything to do with CastSlate — or with acting generally.`+
  `<div class="hd">Things people ask me most</div><ul><li>Building a profile casting actually reads</li><li>Finding and applying to castings</li><li>How free and Premium differ, and what things cost</li><li>Callbacks, self-tapes, and what happens after you submit</li><li>Safety — verified casters, reporting, rules for under-18s</li><li>General industry questions: agents, unions, resumes, rates, nerves</li></ul>`+
  `<p>I can't compare CastSlate to other casting sites, and I don't have live data like weather or news. Everything else, ask away.</p>`,
  b:c=>`What are you trying to sort out?`,
  s:['How do I get started?','Is Premium worth it?','How do I get an agent?']},
 {id:'thanks',re:/^(thanks|thank you|ty|thx|cheers|appreciate it|much appreciated|great thanks|perfect thanks)[\s!.,]*$/i,
  a:c=>`Any time${c.name?', '+c.name:''} 🙌`,b:c=>`Anything else while I'm here?`,s:['No, that\'s all','What is Manager Mode?']},
 {id:'bye',re:/^(bye|goodbye|see ya|see you|later|gtg|got to go|good night|night|that'?s all|no that'?s all|nope)[\s!.,]*$/i,
  a:c=>`Take care${c.name?', '+c.name:''}.`,b:c=>`I'll be right here if something comes up — good luck out there.`,s:[]},
 {id:'ack',re:/^(ok|okay|k|kk|cool|got it|gotcha|nice|great|awesome|sure|alright|yeah|yep|yes|no|nah|lol|haha|hmm|mm|i see)[\s!.,]*$/i,
  a:c=>`👍`,b:c=>`Anything else you want to dig into?`,s:['How do I improve my profile?','What does Premium include?']},
 {id:'huh',re:/^(what|huh|wdym|what do you mean|i don'?t understand|confused|\?+)[\s!.,?]*$/i,
  a:c=>`Sorry — let me try again.`,b:c=>`Tell me what you're trying to do and I'll be more specific.`,s:['How do I apply to a casting?','What does Premium cost?']},
 {id:'rude',re:/(you'?re |ur |you )?(useless|stupid|dumb|garbage|trash|terrible|awful|suck|the worst|hate you|shut up)/i,
  a:c=>`Fair enough — I'd rather be useful than defend myself.`,
  b:c=>`Tell me the actual problem in your own words and I'll either fix it or get a person on it.`,s:['Talk to a human','I have a billing problem']},
 {id:'joke',re:/tell me a joke|make me laugh|say something funny|got any jokes/i,
  a:c=>`An actor gets cast as the lead in a play. Opening night, one line: "Hark, I hear a cannon!" He rehearses it for six weeks.`,
  b:c=>`Curtain goes up. Boom. He says: "What the hell was that?"`,s:['Okay, back to work','How do I prepare for an audition?']}
];

/* ── layer 2: things she declines, once, without lecturing ───── */
const DECLINE=[
 {id:'compare',
  re:/\b(actors ?access|backstage|casting ?networks|castingnetworks|mandy|starnow|star ?now|playbill|breakdown ?express|explore ?talent|project ?casting)\b|\b(better than|compare|comparison|vs\.?|versus) (other|another|any) (site|platform|app)/i,
  a:c=>`${c.name?c.name+', h':'H'}onestly — I can't compare CastSlate to other casting sites. I only know this one.`+
  `<div class="hd">What I can tell you about CastSlate</div><ul><li>Every submission is shown to the casting director <b>one at a time, full-screen</b>, and they have to decide callback or pass. Average review time is <b>over 8 seconds</b> per submission.</li><li>Profiles are <b>free</b> — 1 headshot and ${FREE.sub} submission a week, no card.</li><li>Premium is <b>$99 a year</b> (about $8.25/month) and renews at $99, for unlimited submissions, unlimited photos and video, your Slate Video, your Business Card, weekly Manager Mode check-ins, and the ${DIR}-company agency directory.</li><li>Casting posts are reviewed by admins before they go live, and every caster can be reported.</li></ul>`+
  `<p>What's the right platform for you is genuinely your call — I'd just be guessing about anyone else's.</p>`,
  b:c=>`Anything specific about how CastSlate works that would help you decide?`,
  s:['How does the review actually work?','What does Premium include?','Are the castings real?'],src:['guarantee','pricing']},
 {id:'live',
  re:/\b(weather|temperature|forecast|raining|snowing)\b|what time is it|today'?s date|\b(news|headlines) (today|now)\b|stock price|score (of|for) the|who won (the )?(game|match)/i,
  a:c=>`I don't have live data — no weather, news, scores or prices. A quick search will beat me on that one.`,
  b:c=>`Anything on CastSlate or the acting side I can help with?`,
  s:['How do I improve my profile?','What is a self-tape?']},
 {id:'code',
  re:/\b(python|javascript|java|sql|c\+\+|regex|api key|endpoint)\b|write (me )?(a |an )?(script|program|code|scraper|bot)|scrape|crawl (the|your) site|automate (submissions|applying)/i,
  a:c=>`I can't help with scripting or scraping the platform — CastSlate is meant to be used through the site itself.`,
  b:c=>`If it's volume you're after, the search filters and saved searches will get you there faster than a scraper would. Want me to walk through those?`,
  s:['How do I find roles that fit me?','Why can\'t I apply to more castings?']},
 {id:'pro',
  re:/\b(lawyer|attorney|legal advice|sue|lawsuit|rental|lease|tenancy|mortgage|divorce|contract review|review my [a-z]{0,12} ?contract|tax(es)? advice|file my taxes|invest|stocks|medical|diagnos|prescription|therapy|therapist)\b/i,
  a:c=>`That's outside what I should be answering — contracts, tax, legal and medical questions really do need a qualified professional.`,
  b:c=>`If it's about a CastSlate agreement or a payment on your account, I can hand you to the team instead.`,
  s:['Talk to a human','What are the membership terms?']},
 {id:'misc',
  re:/\b(recipe|cook|restaurant|cafe|bar|hotel|flight|holiday|vacation|homework|essay|translate this|calculate|math problem|dating|relationship advice|who is the president|capital of|football|basketball|soccer|politics|election|vote|voting|president|government|democrat|republican|car|laptop|phone plan|insurance|crypto)\b/i,
  a:c=>`That one's outside my lane — I stick to CastSlate and the acting business.`,
  b:c=>`Anything in that direction I can help with?`,
  s:['How do I get an agent?','What does Premium include?']}
];

/* ── layer 3: knowledge ──────────────────────────────────────── */
const PRICEFINE='$99/year — about $8.25/month, and it renews at $99. Or $14.95 monthly, cancel any time.';
const KB=[

{id:'what',k:'what is castslate about platform explain tell me new here how does it work works legit real',
 a:c=>`CastSlate is a casting platform built for working actors, and the whole thing turns on one promise: <b>every submission you send is seen individually</b>.`+
 `<div class="hd">How it works</div><ul><li>Create a <b>free</b> profile — no card, not a trial</li><li>Browse open castings, organised by city</li><li>Apply to roles you actually fit</li><li>Casting reviews submissions <b>one at a time, full-screen</b>, and has to decide callback or pass on each</li></ul>`+
 `<p>Nobody can scroll past you. Average review time per submission is <b>over 8 seconds</b>.</p>`,
 src:['guarantee','pricing'],s:['How do I get started?','What does it cost?','Are the castings real?']},

{id:'start',k:'get started begin sign up signup register create account first steps new actor join setup',
 a:c=>`Four steps and you're submitting today.`+
 `<ul><li><b>Create your free account</b> — email and password, no card</li><li><b>Upload a headshot</b> — the one thing casting sees first</li><li><b>Add your stats and a two-sentence bio</b> — training, your strongest types, one differentiator</li><li><b>Browse Open Castings and apply</b></li></ul>`+
 `<p>Free accounts submit to <b>${FREE.sub} casting a week</b> and hold <b>${FREE.shots} headshot</b> — enough to learn the place and get real submissions in.</p>`+
 `<p>A profile with a headshot and nothing else gets passed on, because casting can't tell what you're right for. The bio matters more than people expect.</p>`,
 src:['profile','pricing'],s:['How do I apply?','What should my headshot look like?','What does Premium include?'],
 sell:c=>({e:'When one a week stops being enough',h:'Unlimited submissions whenever you\'re ready',b:'Most actors hit the weekly cap in their second or third week — the roles are there, the submissions aren\'t.'})},

{id:'pricing',k:'price cost how much premium membership subscription pay fee dollars month year plan plans expensive cheap billing charge',
 a:c=>`Here's the whole price list — there's nothing behind it.`+
 `<div class="hd">Free — $0, forever</div><ul><li>Full profile and unlimited browsing</li><li>${FREE.shots} headshot</li><li>${FREE.sub} submission per week</li><li>No card required, not a trial</li></ul>`+
 `<div class="hd">Premium</div><ul><li><b>$99 a year</b> — about <b>$8.25 a month</b>, and it renews at $99. No first-year discount that climbs later.</li><li><b>$71.70 for six months</b> — $11.95 a month</li><li><b>$14.95 month to month</b></li></ul>`+
 `<p><b>Every plan includes the same features.</b> No higher tier, no per-submission fees.</p>`+
 (c.plan==='premium'?`<p>You're on Premium, so all of that is already switched on.</p>`:''),
 src:['pricing','billing'],s:['Is it worth it?','Free vs Premium?','How do I cancel?'],
 sell:c=>({e:'What the $8.25 buys',h:'Everything, on every plan',b:'Unlimited submissions · unlimited photos, video and Cast Me As clips · <em>Slate Video</em> · <em>Business Card</em> with QR code · mailing postcard and agent promo card · weekly <em>Manager Mode</em> · the <em>'+DIR+'-company agency directory</em>.'})},

{id:'worth',k:'worth it should i upgrade why pay convince me value bother benefit benefits point premium advantage advantages',
 a:c=>c.plan==='premium'
 ?`Honestly? You already made the right call — the question now is whether you're <b>using</b> all of it. Most members leave the three strongest things switched off:`+
  `<div class="hd">1. Your Actor Business Card</div><p>Headshot on the front, <b>QR code that opens your whole profile in about two seconds</b>. Print it. Hand it out. And mail the postcard version to agency offices from the directory — they scan once instead of typing your name into a search bar and giving up.</p>`+
  `<div class="hd">2. The ${DIR}-company directory</div><p>Agencies and management companies across LA, Beverly Hills and New York, with addresses, websites, contact details, tiers, and <b>how each one wants to be approached</b>. That is the actual map to representation, and it's sitting in your dashboard right now.</p>`+
  `<div class="hd">3. Your Slate Video</div><p>Seven seconds. Casting hears your voice before deciding whether to open your reel. It's the cheapest advantage on the platform and it takes one take.</p>`+
  `<p>Want me to walk you through any of them?</p>`
 :`Yes — and not because of the submission counter. Let me show you what's actually behind it${c.name?', '+c.name:''}.`+
  `<div class="hd">Unlimited submissions, each one seen</div><p>The ${FREE.sub}-a-week cap disappears. And every submission goes to the casting director <b>full-screen, one at a time</b> — they have to decide callback or pass. Average review time is <b>over 8 seconds</b> per person.</p>`+
  `<div class="hd">Your Actor Business Card — with a QR code</div><p>Headshot on the front, and a QR that <b>opens your entire profile — reel, Slate Video, stats, credits — in about two seconds</b>. You also get a <b>mailing postcard</b> and an <b>agent promo card</b>.</p>`+
  `<p>Think about what that means: you mail a postcard to an agency office, someone scans it at their desk, and your full profile is in front of them instantly. No typing your name in, no attachment they won't open, no email that never gets read. That is not a standard casting-site feature. Most platforms sell you a database listing and stop there.</p>`+
  `<div class="hd">The ${DIR}-company Agency & Manager Directory</div><p>Every agency and management company across <b>Los Angeles, Beverly Hills and New York</b> — addresses, websites, contact details, grouped in tiers, with <b>how each one wants to be approached</b> and submission tips written for actors with no representation yet.</p>`+
  `<p>Actors spend years guessing at this, or pay for lists that are out of date. Here it's just included.</p>`+
  `<div class="hd">Manager Mode — every single week</div><p>A private career check-in on <b>your</b> profile: what's working, what needs attention, the casting lane you're most competitive for, and one focused task. Plus real industry events in NY and LA. Most platforms take your money and forget you exist — this one reads your profile every week.</p>`+
  `<div class="hd">And the rest</div><ul><li><b>Slate Video</b> — a 7-second intro so casting hears you</li><li><b>Unlimited photos, video and Cast Me As clips</b> — the right look for every role</li></ul>`+
  `<div class="hd">What it costs</div><p><b>$99 a year</b> — about <b>$1.90 a week</b> — and it renews at $99. Every plan gets every feature. Nothing is held back for a higher tier.</p>`+
  `<p><b>The straight talk:</b> nobody can promise you a booking, and anyone who does is lying to you. What Premium gives you is everything that <em>is</em> in your control — in front of casting as often as you want, with the strongest version of you, and the map to representation in your hands. That's the whole idea behind this place: get talented actors seen, and get them repped.</p>`,
 src:['pricing','card','dir'],s:['Tell me about the Business Card','Tell me about the agency directory','What is Manager Mode?'],
 sell:c=>({e:'About $1.90 a week',h:'Everything, on every plan',b:'Unlimited submissions · <em>Business Card with QR code</em> · mailing postcard and agent promo card · the <em>'+DIR+'-company agency and manager directory</em> · weekly <em>Manager Mode</em> check-ins · <em>Slate Video</em> · unlimited photos and video.',cta:'Go Premium — $99/year'})},

{id:'freevp',k:'free vs premium difference compare tiers what do i get upgrade unlock locked included',
 a:c=>`Every difference, in one list.`+
 `<div class="hd">Free account</div><ul><li>Full profile — stats, bio, credits, reel link</li><li>Browse and search every casting</li><li>Messages and callbacks in your Inbox</li><li>${FREE.shots} headshot</li><li>${FREE.sub} submission per week</li></ul>`+
 `<div class="hd">Premium adds</div><ul><li><b>Unlimited submissions</b></li><li><b>Unlimited photos, videos and Cast Me As clips</b></li><li><b>Slate Video</b> — a 7-second intro on your profile</li><li><b>Business Card</b> with QR code, plus mailing postcard and agent promo card</li><li><b>Manager Mode</b> — a private career check-in every week</li><li><b>Agency & Manager Directory</b> — ${DIR} companies in LA, Beverly Hills and NYC</li></ul>`,
 src:['pricing','card','mm'],s:['Is it worth it?','What is Manager Mode?','How do I upgrade?'],
 sell:c=>({e:'One price, every feature',h:'No tiers, nothing held back',b:'$99 a year — about <em>$8.25 a month</em> — renewing at $99. Or $14.95 monthly if you\'d rather keep it loose.'})},

{id:'cap',k:'cap limit weekly submission limit cant apply cannot apply more submissions used up ran out blocked one a week reached maximum',
 a:c=>c.plan==='premium'
 ?`You shouldn't be hitting a cap — Premium submissions are unlimited. If a role is refusing you, it's one of these:`+
  `<ul><li>The role hit its own <b>submission cap</b> (250–500) and closed automatically</li><li>The deadline passed and the casting director closed it</li><li>You already submitted to that role</li></ul><p>If none of those fit, I'll get the team to look at your account.</p>`
 :`Free accounts submit to <b>${FREE.sub} casting per week</b>, and it resets weekly. Nothing's wrong with your account.`+
  `<div class="hd">Making one submission count</div><ul><li>Spend it on a role you fit by <b>type and experience level</b>, not the most exciting one on the board</li><li>Submit <b>early</b> — many casting directors start reviewing days before the deadline</li><li>Write the two-sentence cover note. Cheapest edge available to you</li></ul>`+
  `<p>Roles also cap themselves at 250–500 submissions so casting can review every one properly.</p>`,
 src:['apply','pricing'],s:['How do I apply?','Is Premium worth it?','What if I miss a deadline?'],
 sell:c=>({e:'This is the wall Premium removes',h:'Unlimited submissions',b:'The cap is the single most common reason actors upgrade — watching roles you fit close while you wait for Monday.',cta:'Remove the cap'})},

{id:'apply',k:'apply applying submit submission how to apply send headshot to casting application cover note letter multiple roles',
 a:c=>`From a casting page, hit <b>Apply Now</b> on the role that fits.`+
 `<ul><li>Choose which headshot to send</li><li>Write a short cover note</li><li>Confirm — it's in the casting director's queue immediately</li></ul>`+
 `<div class="hd">The cover note</div><p><b>Two sentences, maximum</b>, specific to this role. One credit, skill or piece of life experience that's directly relevant. It isn't a cover letter and nobody reads a third paragraph.</p>`+
 `<div class="hd">More than one role</div><p>Apply separately for each role you genuinely fit. Submitting outside your type gets noticed and weakens the reads on roles you do fit.</p>`,
 src:['apply','guarantee'],s:['How will I hear back?','Is my submission really seen?','What is a self-tape?']},

{id:'guarantee',k:'seen guarantee every submission gets seen viewed does anyone look ignored swipe review one at a time full screen',
 a:c=>`It means something specific and measurable, not marketing.`+
 `<ul><li>Submissions are shown <b>one at a time, full-screen</b></li><li>Each one requires an <b>explicit decision</b> — callback or pass</li><li>There's no grid to scroll, so your headshot can't be skimmed past</li><li>We measure review time: the average is <b>over 8 seconds</b> per submission</li></ul>`+
 `<p>For scale, on a grid platform a casting director can scan 80 headshots in about twenty seconds.</p>`+
 `<p>Being seen isn't the same as being cast — it means you were genuinely considered. That's the part CastSlate can guarantee.</p>`,
 src:['guarantee'],s:['How will I hear back?','Why is nobody getting back to me?','How does CastSlate work?']},

{id:'fake',k:'fake real legit genuine authentic castings fake are the castings real trustworthy bogus',
 a:c=>`Short answer: no, they're not fake.`+
 `<ul><li>Every casting is <b>reviewed by CastSlate admins before it goes live</b> — nothing publishes unchecked</li><li>Casters carry a <b>Verified</b> badge once an admin has reviewed them; anyone without it is marked <b>Unverified</b></li><li>Casting directors who post can be put through <b>ID verification</b>, and posting rights are granted separately</li><li>Every casting and every profile has a <b>Report</b> link that goes straight to the admin queue</li></ul>`+
 `<div class="hd">Still use your judgement</div><p>Scams exist everywhere. Walk away if anyone <b>asks you to pay to work</b>, wants financial information, pushes to move off the platform fast, or books an in-person audition somewhere that isn't a real production office or studio.</p>`+
 `<p>Casters who do any of that get suspended, and we keep a record so they can't quietly re-register.</p>`,
 src:['safety'],s:['How do I report something?','What does Verified mean?','Rules for under 18?']},

{id:'scams',k:'scam scams fraud fraudulent con artist ripoff rip off get scammed avoid scams warning signs red flags predatory fees upfront payment',
 a:c=>`Worth knowing the pattern, because casting scams are real across the whole industry and they mostly look the same.`+
 `<div class="hd">Walk away immediately if</div><ul><li>You're asked to <b>pay to be considered</b>, pay for a "mandatory" workshop, or pay a fee to be represented. Real agents take commission <b>after</b> you book</li><li>Someone pushes you off-platform fast — straight to text or WhatsApp before you know who they are</li><li>They ask for your <b>bank details, SSN or a copy of your ID</b> up front</li><li>They send a cheque and ask you to forward part of it. That's a classic overpayment scam and the cheque bounces later</li><li>The audition is at a residence or a hotel room. A real production has an office or a studio</li><li>The role involves nudity or intimacy and there's no written breakdown, no intimacy coordinator, and no proper contract</li></ul>`+
 `<div class="hd">What CastSlate does about it</div><ul><li>Every casting is <b>reviewed by admins before it goes live</b></li><li>Casters carry a <b>Verified</b> badge once reviewed; anyone without one shows as <b>Unverified</b></li><li>Casting directors can be put through <b>ID verification</b>, and posting rights are granted separately</li><li>Every casting and profile has a <b>Report</b> link straight to the admin queue — and the reporter is never shown to the reported party</li><li>Casters who ask talent for money are suspended, with a record kept so they can't quietly re-register</li></ul>`+
 `<div class="hd">Your own rules</div><p>Tell someone where you're going. Bring a chaperone where it's relevant. And if it feels wrong, it is — no role is worth overriding that.</p>`+
 `<p>If you're in immediate danger, contact local emergency services first, then report the posting.</p>`,
 src:['safety'],s:['How do I report something?','What does Verified mean?','Are the castings real?']},

{id:'noresponse',k:'nobody responds response never hear back hearing rejected rejection ignored discouraged nothing happening luck wrong replies silence no callbacks callbacks not booking giving up why arent i getting',
 a:c=>`First thing, and I mean this plainly: <b>this is normal, and it is not a verdict on you.</b>`+
 `<p>A single role can draw hundreds of submissions, and one person books it. Everyone else is passed on — including actors who were excellent, right for it, and would have been great. A pass is a <b>fit decision</b>, not a talent decision, and most casting directors simply don't send notes when they move on. Silence isn't a message. It's just how the queue clears.</p>`+
 `<div class="hd">Things that are actually happening behind the silence</div><ul><li>They went a different direction on type entirely — often after seeing people</li><li>The role got recast, rewritten, cancelled, or the budget moved</li><li>Someone was already attached before the breakdown went out</li><li>It's simply still open. One to three weeks is normal, longer is common</li></ul>`+
 `<div class="hd">What you can actually control</div><p>Not the outcome. Only the inputs — and they do move the needle over time:</p>`+
 `<ul><li><b>A complete profile.</b> Headshot, stats, a two-sentence bio, credits. A profile with a photo and nothing else gives casting nothing to place you against</li><li><b>Footage.</b> A photo says what you look like; nothing says what you're <em>like</em>. This is the most common gap by a distance</li><li><b>Submitting inside your lane</b>, and submitting early rather than on the deadline</li></ul>`+
 `<p>Do those, then let go of the individual results. The actors who get somewhere aren't the ones who never got passed on — they're the ones still submitting in month nine with better materials than they had in month one.</p>`+
 (c.plan==='premium'?`<p>Your Manager Mode note does this diagnosis on your actual profile every week, and names the single thing to fix next — so you're never guessing which of these it is.</p>`:`<p>And if it helps: a quiet stretch is a good time to work on materials rather than volume. That's the part that compounds.</p>`),
 src:['guarantee','profile','apply'],s:['How do I improve my profile?','How do I build a reel with no footage?','What is Manager Mode?'],
 sell:c=>({e:'Never guess which gap is yours',h:'Manager Mode reads your profile every week',b:'What\'s working, what needs attention, the casting lane you\'re most competitive for, and <em>one task</em> — written about your actual profile, not a template.'})},

{id:'profile',k:'profile headshot photo picture bio stats credits reel skills improve better complete completeness what should i put',
 a:c=>`Here's what casting is actually reading, in order.`+
 `<div class="hd">Headshot</div><ul><li>Taken in the <b>last 18 months</b> — it has to look like whoever walks in</li><li><b>800×1000 pixels minimum</b>, JPG or PNG</li><li>Face filling about <b>60% of the frame</b></li><li>Natural or soft studio light, simple background</li></ul>`+
 `<div class="hd">Bio</div><p><b>Two to three sentences.</b> Training first, then your strongest types, then one real differentiator. Cut "I've loved acting since I was five" — it gets read past every time.</p>`+
 `<div class="hd">Credits and reel</div><p>Three most recent credits with years. Paste a YouTube or Vimeo URL into the Reel field — <b>under two minutes</b>, strongest work first.</p>`+
 `<div class="hd">Special skills</div><p>Only what you can do on demand, in a room, today.</p>`+
 (c.plan==='premium'?`<p>Your weekly <b>Manager Mode</b> note already scores this and names the one gap to fix — it lands Mondays.</p>`:''),
 src:['profile','mm'],s:['Headshot requirements?','What is the Slate Video?','What is Manager Mode?'],
 sell:c=>({e:'Stop guessing at your profile',h:'Manager Mode reads it for you, weekly',b:'What\'s working, what needs attention, your casting lane, and <em>one task this week</em> — about your actual profile, not a template.'})},

{id:'headshot',k:'headshot size dimensions pixels resolution upload photo requirements format jpg png how many headshots gallery main photographer',
 a:c=>`Spec first, then the part that matters.`+
 `<div class="hd">Spec</div><ul><li><b>At least 800×1000 pixels</b></li><li>JPG or PNG</li><li>Face filling roughly <b>60% of the frame</b></li><li>Natural or soft studio lighting, simple background</li><li>Shot within the <b>last 18 months</b></li></ul>`+
 `<div class="hd">How many you get</div><p>Free accounts hold <b>${FREE.shots} headshot</b>. Premium gives you a main headshot <b>plus unlimited gallery photos</b>, and the main one stays separate. You choose which photo goes with each submission.</p>`+
 `<div class="hd">The commercial / theatrical split</div><p>One warm, open, smiling look and one grounded dramatic look covers most of what you'll submit for. Sending the dramatic shot to a cereal commercial is a wasted submission.</p>`,
 src:['profile'],s:['How do I improve my profile?','What is the Slate Video?'],
 sell:c=>({e:'Match the photo to the role',h:'Unlimited gallery photos',b:'Pick the right look per submission instead of sending one headshot to every genre.'})},

{id:'slate',k:'slate video 7 second intro record video upload video cast me as clips media what is a slate slating name',
 a:c=>`Two things share that word, so both:`+
 `<div class="hd">Slating, in an audition</div><p>The short piece at the top of a tape where you identify yourself — usually name, sometimes height, agency, the role you're reading for, and a profile turn if they ask. Follow whatever the breakdown specifies exactly.</p>`+
 `<p>The slate is casting's <b>first impression of you as a person</b>, not a character. Be warm, be yourself, look down the lens, and don't perform it. Plenty of decisions get made in those three seconds, before a single line is read.</p>`+
 `<div class="hd">The CastSlate Slate Video</div><p>A <b>7-second intro</b> that lives on your profile — the same idea, but permanent, so casting hears your voice and sees you move before deciding whether to open your reel.</p>`+
 `<ul><li>It sits directly under your headshot, so it's the first thing after the photo</li><li>Seven seconds. Your name, and let them see you. That's the entire brief</li></ul>`+
 `<div class="hd">Cast Me As clips</div><p>Short clips showing the types you're right for, so casting isn't guessing your lane from a still photograph.</p>`+
 (c.plan==='premium'?`<p>You have this — My Profile → Edit Profile → Slate Video. Landscape, near a window, no music, no title card.</p>`:`<p>Free accounts are photo-only, so profiles stay still images.</p>`),
 src:['card','profile'],s:['What is a self-tape?','What is the Business Card?','How do I improve my profile?'],
 sell:c=>({e:'The cheapest advantage on the platform',h:'Seven seconds of you, moving and talking',b:'A photo says what you look like. Seven seconds says what you\'d be like in the room — and it sits above your reel where casting actually sees it.'})},

{id:'card',k:'business card qr code postcard mailing agent promo card print physical networking mail agency office promo materials',
 a:c=>`This is the one I'd want if I were you.`+
 `<p>The <b>Actor Business Card</b> has your headshot on the front and a <b>QR code that opens your entire CastSlate profile — reel, Slate Video, stats, credits — in about two seconds</b>.</p>`+
 `<div class="hd">Why that matters more than it sounds</div><p>Someone scans it once and everything you've built is on their screen. No typing your name into a search bar. No attachment nobody opens. No email buried by Tuesday.</p>`+
 `<div class="hd">Three pieces, not one</div><ul><li><b>Business card</b> — for workshops, sets, mixers, every hallway conversation</li><li><b>Mailing postcard</b> — post it to an agency office from the directory. It lands on a desk, they scan it there, your profile is in front of them</li><li><b>Agent promo card</b> — built for submissions to representation</li></ul>`+
 `<p>Most casting platforms give you a listing in a database and that's the end of the relationship. Physical promo materials that plug straight back into your live profile aren't standard anywhere — that's a deliberate CastSlate thing, because getting you in front of agents is the actual point.</p>`+
 (c.plan==='premium'?`<p>Yours is ready on the dashboard — download the PDF and print anywhere. Order more than you think you need, and pair the postcard with the ${DIR}-company directory.</p>`:''),
 src:['card','dir'],s:['Tell me about the agency directory','What is the Slate Video?','How do I get an agent?'],
 sell:c=>({e:'Nobody else hands you this',h:'Promo materials that open your live profile',b:'Business card, mailing postcard and agent promo card — each carrying a <em>QR code to your full profile</em>. Mail one to an agency office and they scan it at the desk.'})},

{id:'mm',k:'manager mode weekly check in checkin career coach manager guidance task advice events mixers what to fix',
 a:c=>`<b>Manager Mode</b> is a private career check-in written for your profile, in your inbox every week. Not a newsletter — it reads your actual profile and your actual gaps.`+
 `<ul><li><b>What you're doing well</b> — what already reads to casting</li><li><b>What needs attention</b> — the one thing holding the profile back</li><li><b>Your casting lane</b> — what you're most competitive for right now</li><li><b>One task this week</b> — one, not a checklist of twelve</li></ul>`+
 `<p>It also suggests real industry events in <b>New York and Los Angeles</b> — mixers, showcases, workshops — because the business still runs on rooms.</p>`+
 `<p>It's a profile-improvement tool. It doesn't guarantee bookings, callbacks or representation, and it'll never tell you it can.</p>`+
 (c.plan==='premium'?`<p>Yours runs weekly and lands Mondays. If you're not seeing it, check spam and mark it "not spam" once.</p>`:''),
 src:['mm','card'],s:['Tell me about the agency directory','How do I improve my profile?'],
 sell:c=>({e:'Before you have a manager',h:'Someone reading your profile every week',b:'Most platforms take your money and forget you exist. One focused task a week, written about you, until the profile does its job.'})},

{id:'dir',k:'agency directory agent manager representation agencies management companies get an agent submit to agents la nyc beverly hills list addresses websites',
 a:c=>`The <b>Talent Agency & Manager Directory</b> — <b>${DIR} agencies and management companies</b> across Los Angeles, Beverly Hills and New York.`+
 `<div class="hd">What's actually in it</div><ul><li>Company names, <b>addresses, websites and contact details</b></li><li>Grouped into <b>tiers</b>, so you can tell who realistically reads unsolicited submissions</li><li><b>How each one wants to be approached</b> — the piece nobody tells you</li><li>Submission tips written specifically for actors with no representation yet</li></ul>`+
 `<div class="hd">Why this is the big one</div><p>Getting an agent is the single hardest door in this business, and most actors waste a year mailing identical packages to companies that were never going to read them. Actors pay for lists that are out of date. This one is maintained, tiered, and included.</p>`+
 `<p>Pair it with your <b>mailing postcard</b>: post a card with a QR to an agency office, and your whole profile opens on their desk. That combination is what the directory was built for — and it isn't something other casting sites offer.</p>`+
 (c.plan==='premium'?`<p>It's in your dashboard now. Start with the tier that takes unsolicited submissions, not the top of the list.</p>`:''),
 src:['dir','card'],s:['How do I get an agent?','Tell me about the Business Card','What is Manager Mode?'],
 sell:c=>({e:'The map to representation',h:DIR+' agencies and managers, and how to approach each',b:'Addresses, websites, contact details and tiers across LA, Beverly Hills and NYC — plus your <em>agent promo card</em> and <em>mailing postcard</em>. Free accounts see it with company details redacted.'})},

{id:'callback',k:'callback call back hear back response notified notification status shortlist result what happens after how long wait',
 a:c=>`Callbacks land in two places at once — your <b>Inbox</b> and a badge on the nav.`+
 `<ul><li>The casting director sends <b>three time slots</b> and a short message</li><li>You get it by email <b>and</b> as an inbox message</li><li>You reply in the same thread</li></ul>`+
 `<div class="hd">On timing</div><p>Most movement happens within <b>one to three weeks</b>, but it varies wildly by production. A pass usually isn't a note — plenty of casting directors clear a queue without messaging everyone.</p>`+
 `<p>If a casting director you respect passes, one short polite message asking what was missing is fair. Some answer, and those notes are worth more than another ten submissions.</p>`,
 src:['apply','guarantee'],s:['Why is nobody getting back to me?','What is a self-tape?']},

{id:'tape',k:'tapelink self tape selftape sides script audition video record submit tape take limit',
 a:c=>`<b>TapeLink</b> is CastSlate's built-in self-tape workflow — it all happens on the role page.`+
 `<ul><li>The casting director attaches the <b>sides</b> (usually a one-page PDF) plus their self-tape instructions</li><li>You download the sides and practise with your device camera</li><li>You record and <b>submit the tape straight back</b> — no file-transfer service, no separate email</li></ul>`+
 `<div class="hd">Tape basics</div><p>Landscape, eyeline just off camera, clean wall behind you, best light in your apartment. <b>Sound matters more than resolution</b> — get close to the phone.</p>`,
 src:['tape','apply'],s:['What are sides?','How do I apply?']},

{id:'cancel',k:'cancel cancelling unsubscribe stop subscription end membership turn off auto renew quit downgrade stop charging me dont want premium anymore stop paying leave',
 a:c=>`<p>Here is exactly how, and it takes about a minute.</p>`+
 `<div class="hd">Cancelling</div>`+
 `<ol><li>Sign in and open <b>Account Settings</b></li><li>Go to <b>Payment &amp; Billing</b></li><li>Under <b>Plan management</b>, click <b>Manage subscription</b></li><li>That opens your secure <b>Stripe billing page</b> — cancel there and confirm</li></ol>`+
 `<p><button class="inl" data-nav="account-settings">Take me to Account Settings</button></p>`+
 `<div class="hd">What happens next</div>`+
 `<ul><li>You keep <b>full Premium access until the end of the period you already paid for</b> — cancelling does not cut you off on the day</li><li>After that the account returns to the <b>free plan automatically</b></li><li><b>Nothing is deleted.</b> Your profile, your media and your application history all stay exactly as they are</li><li>You can restart from the same billing page whenever you want</li></ul>`+
 `<p>The same page is also where you update your card or download invoices.</p>`+
 `<div class="hd">If you would rather not do it yourself</div>`+
 `<p>There is a <b>"Prefer we do it? Contact us"</b> link right beside that button, and the team will handle it for you.</p>`+
 `<p style="opacity:.75">I cannot cancel it from this chat — only you can, from your own account. I will not tell you it is done unless you have done it.</p>`,
 src:['billing'],s:['Will I get a refund?','What happens to my profile?','I have a billing problem'],nocheck:true},

{id:'cancelvsdelete',k:'leave castslate completely quit entirely difference between cancelling and deleting close everything remove me',
 a:c=>`<p>Two different things, and it is worth being clear which you want.</p>`+
 `<div class="hd">Cancel Premium</div>`+
 `<p>Stops the payments. Your account stays, your profile stays, your submissions stay — you simply drop back to the free plan at the end of the period you have paid for.</p>`+
 `<p><button class="inl" data-ask="How do I cancel my subscription?">Show me how to cancel</button></p>`+
 `<div class="hd">Delete your account</div>`+
 `<p>Removes the account itself. <b>Account Settings → Deactivation &amp; Deletion → Delete my account.</b> Deletion is immediate, and you can sign up again later with the same email if you change your mind.</p>`+
 `<p><button class="inl" data-ask="How do I delete my account?">Show me how to delete</button></p>`+
 `<p>If you are only trying to stop being charged, <b>cancelling is the one you want</b> — deleting is not necessary for that.</p>`,
 src:['billing','acct'],s:['How do I cancel my subscription?','How do I delete my account?'],nocheck:true},

{id:'billinginfo',k:'next billing date when am i charged how much am i paying renewal date payment method change card update card resubscribe restart premium do i still have premium why did premium disappear invoice receipt',
 a:c=>`<p>I cannot see your account or your billing from this chat, and I am not going to guess at it — anything about <em>your</em> card, dates or charges has to come from your own account.</p>`+
 `<div class="hd">Everything account-specific lives in one place</div>`+
 `<p><b>Account Settings → Payment &amp; Billing → Manage subscription</b> opens your secure Stripe billing page. From there you can see your renewal date, update your card, download invoices, cancel, or restart a cancelled membership.</p>`+
 `<p><b>Subscription Info</b> in the same settings menu shows your current plan and renewal date without leaving CastSlate.</p>`+
 `<p><button class="inl" data-nav="account-settings">Take me to Account Settings</button></p>`+
 `<div class="hd">What I can tell you</div>`+
 `<p>The published prices: <b>$99 a year</b> (about $8.25/month, renewing at $99), <b>$71.70 for six months</b>, or <b>$14.95 month to month</b>. Every plan includes every feature.</p>`+
 `<p>If Premium access has disappeared unexpectedly, or a charge looks wrong, that goes to a person rather than to me — say the word and I will hand this over.</p>`,
 src:['billing','pricing'],s:['How do I cancel my subscription?','I have a billing problem','Talk to a human'],nocheck:true},

{id:'refund',k:'refund charged twice double charge billing problem dispute wrong amount receipt invoice payment failed card declined money back overcharged',
 a:c=>`<p>The policy first, straight: <b>membership fees are non-refundable except where the law requires it.</b> I am not going to promise you a refund I cannot authorise.</p>`+
 `<p>What softens it is that a cancelled membership <b>runs to the end of the period you already paid for</b> — you are not losing time you have paid for, so cancelling and refunding are not the same question.</p>`+
 `<div class="hd">If a charge looks wrong</div>`+
 `<p>That is a person's job, not mine, and they can actually look at your account.</p>`+
 `<ul><li><b>Account Settings → Payment &amp; Billing → Manage subscription</b> — your Stripe page has every invoice and receipt</li><li>Receipts are also emailed automatically after each transaction</li><li>Cards are processed by Stripe. <b>CastSlate never stores your card details</b></li></ul>`+
 `<p><button class="inl" data-ask="Talk to a human">Hand this to the team</button></p>`,
 src:['billing'],s:['How do I cancel my subscription?','Talk to a human'],nocheck:true},

{id:'upgrade',k:'how do i upgrade buy premium purchase go premium subscribe checkout pay now where do i pay',
 a:c=>c.plan==='premium'?`You're on Premium already, so it's all live. Want me to walk you through a piece of it — the promo materials, the agency directory, or Manager Mode?`
 :`Two taps.`+
 `<ul><li>Open <b>Membership</b> from the nav, or any "Go Premium" button</li><li>Pick your term — <b>$99/year</b>, <b>$71.70/6 months</b>, or <b>$14.95/month</b></li><li>Pay by card. Live immediately, no waiting on approval</li></ul>`+
 `<p>Every plan carries the same features, so the only real question is how long you want to commit for.</p>`,
 src:['pricing','billing'],s:['What does Premium include?','How do I cancel?'],
 sell:c=>({e:'Live the moment you pay',h:'Unlimited submissions from today',b:'Plus your <em>Slate Video</em>, <em>Business Card</em>, weekly <em>Manager Mode</em> note and the <em>'+DIR+'-company agency directory</em>.',cta:'Go to Membership'})},

{id:'cdpost',k:'post a casting posting project breakdown casting director producer hire talent free to post approval',
 a:c=>`Posting on CastSlate is <b>free</b> for casting directors and producers.`+
 `<div class="hd">Posting</div><ul><li>Create a free industry account</li><li>Dashboard → <b>Post Casting</b></li><li>Fill out the breakdown — title, type, location, role specs, pay, deadline</li><li>It goes live after <b>admin review</b></li></ul>`+
 `<div class="hd">Reviewing</div><p>Submissions come <b>one at a time, full-screen</b>. Swipe right or click Callback; swipe left to pass. You can switch to a grid of headshots from the review header.</p>`+
 `<div class="hd">Caps</div><p>Roles cap at <b>250–500</b> so every submission gets real attention. The role closes automatically at the cap.</p>`,
 src:['cd','guarantee'],s:['What does Verified mean?','How does the review work?']},

{id:'cdverify',k:'verified badge verification id identity verify approved allowed to post trust green badge unverified',
 a:c=>`<div class="hd">What the badge means</div><p>Green <b>Verified</b> means a CastSlate admin reviewed that caster — they've posted before, are tied to a recognised production, or supplied documentation. Anyone without it is marked <b>Unverified</b> until that review happens.</p>`+
 `<div class="hd">Getting verified as a caster</div><ul><li>Complete <b>ID verification</b> through our verification partner</li><li>Passing the ID check marks you verified — <b>posting rights are granted separately</b> by an admin</li></ul>`+
 `<p>As an actor: treat unverified posts with extra care. Confirm details, and where you can, ask for a phone or video conversation before sharing personal information.</p>`,
 src:['safety','cd'],s:['Are the castings real?','How do I report something?']},

{id:'safety',k:'safe safety scam sketchy suspicious dangerous audition location trust worried creepy uncomfortable',
 a:c=>`Short version: <b>no legitimate casting on CastSlate will ask you for money or financial information.</b> Anyone who does gets suspended.`+
 `<div class="hd">Before you go</div><ul><li>Check for the green <b>Verified</b> badge</li><li>In-person callbacks belong at a <b>verified production office or studio</b> — not a residence, not a hotel room</li><li>Bring a chaperone where relevant, and tell someone where you're going</li><li>If the location, the timing or the request feels off, <b>don't go</b>. No role is worth it</li></ul>`+
 `<div class="hd">Reporting</div><p>Use the <b>Report</b> link on any casting or profile. It goes to the admin queue with your reason and details, and <b>the reporter is never shown to the reported party</b>.</p>`+
 `<p>If you're in immediate danger, contact local emergency services first, then report the posting.</p>`,
 src:['safety'],s:['How do I report something?','Rules for under 18?','Are the castings real?']},

{id:'report',k:'report reporting flag abuse harassment inappropriate impersonation complaint',
 a:c=>`Every casting page and every profile carries a <b>Report</b> link.`+
 `<ul><li>Pick a reason — scam, inappropriate content, impersonation, concerns about a minor, other</li><li>Add details; specifics help enormously</li><li>It lands in the admin <b>Reports queue</b> immediately</li></ul>`+
 `<p>Admins mark each one Reviewing, Actioned or Dismissed. Posts that violate our standards get removed, and casters who ask talent for payment are <b>suspended or banned</b> — with an internal record so they can't quietly re-register.</p>`+
 `<p><b>Anything involving a minor is escalated to a person immediately.</b> Say the word and I'll hand this thread over now.</p>`,
 src:['safety'],s:['Talk to a human','Rules for under 18?']},

{id:'minor',k:'minor under 18 child kid teenager parent guardian age young son daughter coppa',
 a:c=>`Talent under 18 <b>must register a parent or legal guardian's email at signup</b>, and the guardian manages the account.`+
 `<ul><li>No unsupervised platform access for minors</li><li>A minor's contact information is <b>never displayed publicly</b></li><li>Casters posting roles for minors must comply with <b>COPPA</b> and state child-performer laws</li></ul>`+
 `<p>Any concern at all about a casting involving a minor — use the Report link and say so in the details. Those go to the top of the queue, and I can put you with a person right now.</p>`,
 src:['safety','acct'],s:['Talk to a human','How do I report something?']},

{id:'privacy',k:'privacy data who can see my profile visible public hidden search sell data tracking cookies gdpr export download',
 a:c=>`<div class="hd">Who sees your profile</div><ul><li>Verified casting directors and producers see profiles of talent who <b>submitted to their castings</b></li><li>Public-facing profiles are <b>opt-in only</b></li><li>You can hide your profile from search entirely</li></ul>`+
 `<div class="hd">What we do and don't do</div><p>We collect what you put in your profile plus basic account data. <b>We do not sell, license or share your data with third parties for advertising.</b> Necessary cookies are always on; analytics and marketing cookies are <b>off by default</b>.</p>`+
 `<div class="hd">Getting a copy</div><p><b>My Profile → Account → Export Data</b> — profile and full submission history as one file.</p>`,
 src:['acct'],s:['How do I delete my account?','Is CastSlate safe?']},

{id:'delete',k:'delete account deactivate remove close my account erase leave permanently',
 a:c=>`<b>Account Settings → Deactivation & Deletion → Delete my account.</b>`+
 `<ul><li>Deletion is <b>immediate</b></li><li>You can sign up again later with the same email</li><li>Some transactional records — receipts, support tickets — are kept where law requires</li></ul>`+
 (c.plan==='premium'?`<p>You're on Premium: deleting isn't the same as cancelling. Cancel first from Account Settings → Manage subscription so billing stops cleanly, then delete.</p>`:'')+
 `<p>If something specific pushed you here, tell me what it was. I'd rather fix it, and if I can't, I'll get you a person.</p>`,
 src:['acct','billing'],s:['Talk to a human','How do I cancel?']},

{id:'login',k:'login log in password reset forgot password cant sign in email change locked out access confirmation link expired',
 a:c=>`<div class="hd">Password</div><p>Use <b>Forgot password</b> on the login page. If nothing arrives in a couple of minutes, check spam before requesting another — repeated requests trip a rate limit and you'll wait longer.</p>`+
 `<div class="hd">Confirmation link expired</div><p>Request a new confirmation email from the login page. The new link works on any device.</p>`+
 `<div class="hd">Changing email or password</div><p><b>My Profile → Account.</b> Both need email re-verification.</p>`+
 `<p>Still locked out after a fresh reset? I'll get the team on it — they can look at the account directly.</p>`,
 src:['acct'],s:['Talk to a human','Who can see my profile?']},

{id:'classes',k:'classes class workshop training acting class book a class lessons teacher coach study worth it',
 a:c=>`CastSlate hosts <b>acting classes and workshops</b> taught by working professionals, on the Classes page.`+
 `<div class="hd">Booking</div><ul><li>Find a class and <b>request a spot</b> — you need a talent profile to request</li><li>The instructor or an admin <b>approves</b> it</li><li>You get an email and an in-app notification with a link to <b>pay and confirm</b></li></ul>`+
 `<div class="hd">Choosing a class generally</div><p>One teacher who sees you weekly for six months moves your work further than three teachers in a year. Audit before you commit, and be suspicious of anything that promises access to casting directors as the selling point.</p>`,
 src:[],s:['How do I improve my profile?','How do I prepare for an audition?']},

{id:'union',k:'sag aftra union aea equity non-union eligible eligibility taft hartley must join membership union status filter',
 a:c=>`<b>SAG-AFTRA, AEA and non-union castings are all supported.</b> Union status is displayed on every casting post and you can filter by it.`+
 `<div class="hd">On eligibility, generally</div><ul><li>Most people become SAG-AFTRA eligible through a <b>principal role on a union production</b> (Taft-Hartley), enough background vouchers, or membership in a sister union</li><li>Once you join, you generally <b>can't work non-union</b> under the same union's jurisdiction — so people often build credits non-union first, deliberately</li><li>Joining costs real money up front. It isn't a milestone to rush</li></ul>`+
 `<p>Rules change and vary by contract — check with the union directly before making a decision.</p>`,
 src:['apply'],s:['How do I get an agent?','What do actors get paid?']},

{id:'agent',k:'agent manager representation get an agent signed submit to agents query letter how do i get representation agency submission mailing approach',
 a:c=>`No agent signs you off a headshot alone. What they're deciding is one thing: <b>are you bookable right now</b> — can they send you out this month and have you hold up in the room.`+
 `<div class="hd">What they need to see</div><ul><li><b>Footage.</b> A reel, or even one strong self-tape. This is the piece most actors skip, and it's the piece that decides it</li><li>Current headshots that look like whoever walks through the door</li><li>Credits and training, and a clear sense of your type</li><li>That you're in a market where they can actually send you out</li></ul>`+
 `<div class="hd">The part that used to be broken</div><p>Mailing agencies has always been the standard advice, and it always had a hole in it: a card or a headshot on a desk is <b>paper</b>. An agent looking at it can't hear you, can't see you move, can't watch a scene. To see any of that they'd have to type your name into a search, or open an email attachment, or chase a link — and most of the time they simply don't.</p>`+
 `<p>That's the specific problem CastSlate's <b>agent promo card</b> and <b>mailing postcard</b> were built for. Each one carries a <b>QR code that opens your live profile in about two seconds</b> — reel, Slate Video, unlimited footage and photos, credits, skills, social links, all of it, right there at their desk. Paper that plays.</p>`+
 `<p>So mailing is worth doing properly again. Print the cards, work through the directory tier by tier, and send something that actually opens.</p>`+
 `<div class="hd">How to approach</div><ul><li><b>Research first.</b> Some companies take unsolicited submissions and some don't. Sending to the ones that do is the whole game — the ${DIR}-company directory tells you which is which, and how each one wants to be contacted</li><li>Keep it short. Who you are, your type, one line about why <em>them</em>, and the card or link</li><li>A referral from a class, a casting director, or a current client beats a cold submission every time</li><li>Follow up once. Then let it go and keep working</li></ul>`+
 `<div class="hd">One hard rule</div><p><b>Never pay a fee to be represented.</b> Legitimate agents take a commission from work you book, after you book it. Anyone charging upfront for representation, mandatory photos, or a "registration" is not an agent.</p>`,
 src:['dir','card'],s:['What is the difference between an agent and a manager?','Tell me about the agency directory','How do I build a reel with no footage?'],
 sell:c=>({e:'Paper that actually plays',h:'Promo cards with a QR to your live profile',h2:'',b:'Print the agent promo card and mailing postcard, then work the <em>'+DIR+'-company directory</em> — addresses, tiers, and how each company wants to be approached.'})},

{id:'selftape',k:'self tape how to record audition at home lighting sound camera phone setup framing eyeline reader',
 a:c=>`Self-tapes are won on <b>sound and eyes</b>, not production value.`+
 `<div class="hd">Setup</div><ul><li><b>Landscape</b>, phone at eye height, framed chest-up unless they ask otherwise</li><li>Clean, plain wall. Blue, grey or beige. Nothing behind you</li><li>Face your best window, or put a lamp behind the phone. Never a window behind <em>you</em></li><li><b>Get the phone close</b> — phone mics are directional and distance kills you</li></ul>`+
 `<div class="hd">Performance</div><ul><li>Eyeline just <b>beside</b> the lens, not into it, unless the brief says direct address</li><li>Use a live reader if you possibly can — someone flat and quiet, off-camera</li><li>Slate the way they asked. If they didn't ask, don't add one</li><li>Two takes, different choices. Send the braver one</li></ul>`+
 `<p>Nobody is grading your apartment. They're deciding whether they believe you.</p>`,
 src:['tape'],s:['What are sides?','What is TapeLink?','How do I prepare for an audition?']},

{id:'sides',k:'sides what are sides script pages breakdown what does sides mean scene',
 a:c=>`<b>Sides</b> are the pages from the script you're reading for — usually one to three pages, sometimes a single scene.`+
 `<ul><li>They're not the whole script, and you usually won't get the whole script</li><li>The <b>breakdown</b> is different — that's the description of the project and the roles, including type, age range and pay</li><li>Read whatever context you're given carefully. Character descriptions in a breakdown tell you what they think they want</li></ul>`+
 `<p>On CastSlate, sides come attached to the role through <b>TapeLink</b> when a casting director wants a tape.</p>`,
 src:['tape'],s:['What is a self-tape?','What is TapeLink?']},

{id:'resume',k:'resume no credits cv experience beginner starting out nothing to put credits list format',
 a:c=>`Everyone starts with an empty resume. Don't pad it — casting can spot invented credits instantly and it's the fastest way to be quietly passed on.`+
 `<div class="hd">What to put when you have nothing</div><ul><li><b>Training</b> — classes, workshops, teacher names, school. This is the whole top of a beginner's resume, and that's fine</li><li><b>Student films, shorts, web series, community and fringe theatre.</b> All real credits</li><li><b>Special skills you can actually do</b> — instruments, sports, dialects, driving stick, languages</li><li>Honest stats. Never lie about height, age range or whether you can ride a horse</li></ul>`+
 `<p>Six months of consistent class work and three short films is a real resume. Say what's true, clearly.</p>`,
 src:['profile'],s:['How do I improve my profile?','How do I build a reel with no footage?']},

{id:'reel',k:'reel showreel demo reel no footage build a reel clips edit footage montage',
 a:c=>`A reel is proof you can act on camera. If you have no footage, you make some — you don't wait for someone to hand it to you.`+
 `<div class="hd">If you have nothing</div><ul><li><b>Ask for footage from everything you shoot.</b> Ask before the shoot, in writing. Student and indie sets often never send it unless you push</li><li>Shoot a two-minute scene yourself with someone from class. A well-lit self-produced scene beats no reel</li><li>A single strong <b>self-tape</b> is legitimate reel material</li></ul>`+
 `<div class="hd">Cutting it</div><ul><li><b>Under two minutes.</b> Strongest work in the first fifteen seconds</li><li>Lead with a clip where you're clearly in frame and speaking</li><li>No montage openers, no music beds, no title card longer than a second</li><li>Same type throughout beats variety — you're proving one thing, not five</li></ul>`,
 src:['profile','card'],s:['How do I improve my profile?','What is the Slate Video?']},

{id:'type',k:'type typecast casting lane what is my type what am i right for category look brand',
 a:c=>`Your "type" is the shorthand casting uses to place you in about three seconds — roughly age range, energy, and what you read as before you speak.`+
 `<ul><li>It's about <b>how you land</b>, not how you see yourself. Those are usually different, and the gap costs actors years</li><li>Ask five people who've seen you work what they'd cast you as. The overlap is your answer</li><li>Submitting inside your lane raises your hit rate; submitting outside it lowers it — and casting notices the pattern</li></ul>`+
 `<p>Type isn't a ceiling. It's the door. You widen the range once you're through it.</p>`+
 (c.plan==='premium'?`<p>Your weekly Manager Mode note names the lane you're most competitive for right now, based on your actual profile.</p>`:''),
 src:['profile','mm'],s:['How do I improve my profile?','What is Manager Mode?'],
 sell:c=>({e:'Not sure what your lane is?',h:'Manager Mode names it for you',b:'A weekly read of your actual profile: what\'s working, what needs attention, <em>your casting lane</em>, and one task.'})},

{id:'audition',k:'audition prepare preparation nerves nervous anxiety room in person tips how to prepare memorize lines',
 a:c=>`Preparation is what turns nerves into something usable.`+
 `<div class="hd">Before</div><ul><li>Make a <b>choice</b>. Specific and wrong beats general and safe every time</li><li>Know the first and last line cold. The middle can breathe</li><li>Read whatever context you were given — genre and tone change everything</li><li>Bring the sides. Holding them is normal and nobody minds</li></ul>`+
 `<div class="hd">In the room</div><ul><li>They want you to be good. You solve their problem when you are</li><li>If they give an adjustment, <b>take it fully</b> — that's usually what they're testing</li><li>Don't apologise, don't explain, don't ask to start over more than once</li></ul>`+
 `<p>Nerves mean it matters. The way through is preparation, not calm.</p>`,
 src:[],s:['What is a self-tape?','How will I hear back?']},

{id:'pay',k:'pay rate money paid scale how much do actors make salary compensation deferred unpaid copy credit meals',
 a:c=>`Rates are listed on every CastSlate casting — pay is part of the breakdown, not something you find out later.`+
 `<div class="hd">What you'll see</div><ul><li><b>Union scale</b> on union productions — set by contract, varies by medium and budget tier</li><li><b>Flat day rates</b> on non-union work</li><li><b>Copy, credit and meals</b> on student and indie shorts. Legitimate, and common early on — just know that's what you're agreeing to</li></ul>`+
 `<p>Two rules worth keeping: <b>never pay to work</b>, and get the terms in writing before the shoot day.</p>`+
 `<p>I can't tell you what any individual role should pay — that depends on the contract, the market and the budget.</p>`,
 src:['safety'],s:['Is SAG-AFTRA supported?','Is CastSlate safe?']},

{id:'extras',k:'extra background work atmosphere supporting artist worth it bg',
 a:c=>`Background work is real, paid, and easy to overvalue.`+
 `<div class="hd">What it's good for</div><ul><li>Being on a professional set and learning how one runs</li><li>Steady paid days when you need them</li><li>Union vouchers, if you're pursuing SAG-AFTRA eligibility that way</li></ul>`+
 `<div class="hd">What it isn't</div><ul><li>A path to being cast in principal roles. Different pipeline, different people</li><li>A resume credit for principal submissions — it generally doesn't belong there</li><li>A place to approach the director. Don't</li></ul>`+
 `<p>Do it for the vouchers, the money, or the education. Not as a strategy for getting seen.</p>`,
 src:[],s:['Is SAG-AFTRA supported?','How do I get an agent?']},

{id:'move',k:'move moving to la new york city relocate market where should i live should i move',
 a:c=>`I can't make that call for you, but the honest version of the tradeoff:`+
 `<ul><li><b>LA and New York</b> have the most volume — and the most competition, and the highest cost of surviving a slow year</li><li><b>Atlanta, Chicago, New Orleans, Albuquerque</b> and others have real production and a much shorter queue</li><li>Moving before you have footage, a resume and some savings usually means a year of survival jobs and no auditions</li></ul>`+
 `<p>Build the materials where you are, prove you can work, then move into a market with something to show. On CastSlate, castings are organised by city so you can see what's actually shooting near you first.</p>`,
 src:[],s:['Where is CastSlate available?','How do I build a reel with no footage?']},

{id:'encourage',k:'too old too late give up quit worth pursuing am i wasting my time discouraged should i keep going no talent',
 a:c=>`I'm not going to give you a motivational poster, so here's the useful version.`+
 `<ul><li><b>Age isn't the barrier people think.</b> Every production needs 40s, 50s, 60s and up, and there is far less competition there than at 22</li><li>What actually ends careers is stopping the craft work — not rejection, and not a slow year</li><li>The actors who move are the ones with a current headshot, real footage, an ongoing class, and a submission habit. That's it. It's unglamorous and it's the whole thing</li></ul>`+
 `<p>If you're asking because it's been a hard month: that's normal, and it isn't evidence about you.</p>`+
 `<p>Pick the smallest next thing — one class, one self-tape, one updated headshot — and do that one.</p>`,
 src:['profile'],s:['How do I improve my profile?','How do I build a reel with no footage?']},

{id:'where',k:'where available city location country international outside us market region local roles near me',
 a:c=>`CastSlate works <b>anywhere with a browser</b> — creating a profile and browsing has no geographic restriction.`+
 `<p>Castings are <b>organised by city</b>, so what you see is filtered to your market. The most volume sits in <b>New York</b> and <b>Los Angeles</b>, which is also where the ${DIR}-company agency directory is focused.</p>`+
 `<p>If your market is thin right now, keep the free account and keep the profile current. Nothing expires.</p>`,
 src:['pricing'],s:['How do I get started?','Should I move to LA or NY?']},

{id:'deadline',k:'deadline late missed closed expired too late timing when to submit early',
 a:c=>`You can still submit after a deadline shows, but expect <b>lower review priority</b> — many casting directors start reviewing days before it closes.`+
 `<ul><li><b>Submit early.</b> The freshest pass gets the most attention</li><li>Roles also close automatically at their cap (250–500), sometimes before the deadline</li></ul>`+
 `<p>The most common reason actors miss roles they were right for isn't competition — it's waiting until the last day.</p>`,
 src:['apply'],s:['Why can\'t I apply to more castings?','How do I apply?']},

{id:'emails',k:'email emails notifications notified alerts daily digest newsletter unsubscribe too many stop emails alerted',
 a:c=>`CastSlate emails when something actually happens, plus a <b>daily casting digest</b> of new roles.`+
 `<ul><li><b>Callbacks and messages</b> — email and an inbox badge at once</li><li><b>Daily casting digest</b> — fresh roles, newest first</li>${c.plan==='premium'?'<li><b>Manager Mode</b> — your weekly career check-in</li>':''}</ul>`+
 `<p>Every marketing email has an unsubscribe link, and unsubscribing never touches callbacks or account notices.</p>`+
 `<p>If digests stopped arriving, check spam and mark one "not spam" — a single spam flag can silence the whole address.</p>`,
 src:['acct'],s:['How will I hear back?','Who can see my profile?']},

{id:'beginner',k:'become an actor how do i start no experience beginner want to be an actor get into acting break in starting from zero',
 a:c=>`Happy to map it out — but "actor" covers a lot of different jobs, and the advice genuinely changes depending on which one you want.`+
 `<div class="hd">Which lane are you aiming at?</div><ul><li><b>Film and TV</b> — deep character and scene work, self-tapes, reels, type matters enormously</li><li><b>Commercial</b> — personality, warmth and clarity in seconds; very different skill, very different auditions</li><li><b>Theater</b> — live technique, voice and body, monologues and open calls</li><li><b>Voiceover</b> — a separate business with its own demo, home booth and agents</li><li><b>Background / extra work</b> — paid days on real sets, a legitimate way to learn how production works</li></ul>`+
 `<p>Tell me which of those pulls at you — or if you're not sure, say so and I'll help you work it out. Most people start in two lanes at once, and that's fine.</p>`+
 `<div class="hd">What's true no matter which you pick</div><ul><li>Get into an ongoing class with one teacher. Not three teachers in a year</li><li>Get one current headshot that looks like you</li><li>Get footage, even self-shot. This is the thing everyone delays and everyone needs</li><li>Start submitting to things you're genuinely right for, weekly, and treat it as a habit rather than an event</li></ul>`+
 `<p>You don't need permission, a degree, or an agent to start. You need materials and a submission habit.</p>`,
 src:['profile'],s:['How do I become a commercial actor?','Do I need acting school?','How do I get my first credit?']},

{id:'lessons',k:'lesson lessons teach me class learn acting exercise train practise practice free lesson mini lesson study coach masterclass',
 a:c=>`<p>Yes — I actually teach rather than just define things. Each one is a real exercise you do on the spot, in two or three minutes.</p>`+
 `<div class="hd">Film &amp; camera</div><ul><li><button class="inl" data-ask="The camera sees everything">The camera sees everything</button> — the show-it vs want-it experiment</li><li><button class="inl" data-ask="Working in a close-up">Working in a close-up</button> — what the lens catches, and the mute-playback exercise</li><li><button class="inl" data-ask="How to stop overacting">How to stop overacting</button> — the flat pass</li></ul>`+
 `<div class="hd">Technique</div><ul><li><button class="inl" data-ask="Objective">Objective</button> — what your character actually wants</li><li><button class="inl" data-ask="Stanislavsky's Magic If">Stanislavsky's Magic If</button> </li><li><button class="inl" data-ask="Listening">Listening</button> </li><li><button class="inl" data-ask="Being present">Being present</button> </li><li><button class="inl" data-ask="Subtext">Subtext</button> — one line, four meanings</li><li><button class="inl" data-ask="Stakes">Stakes</button> — why your scene feels flat</li></ul>`+
 `<div class="hd">Audition</div><ul><li><button class="inl" data-ask="Self-tape exercise">Self-tape exercise</button> — a better take in fifteen minutes</li><li><button class="inl" data-ask="How to slate">How to slate</button> </li><li><button class="inl" data-ask="Cold reading">Cold reading</button> without panicking</li><li><button class="inl" data-ask="The room">The room</button> — first impressions, taking direction, recovering from a mistake</li></ul>`+
 `<div class="hd">By medium</div><ul><li><button class="inl" data-ask="Stage acting">Stage acting</button> — filling the room without inflating</li><li><button class="inl" data-ask="Commercial acting">Commercial acting</button> </li><li><button class="inl" data-ask="Voice acting">Voice acting</button> </li></ul>`+
 `<p>Tap any of those, or just tell me what is going wrong and I will pick.</p>`,
 src:[],s:['The camera sees everything','Teach me how to listen','How do I stop overacting?','Give me a self-tape exercise'],nocheck:true},

{id:'filmvsstage',k:'film vs stage difference theater screen acting scale bigger smaller which is harder medium',
 a:c=>`Different scale, same craft. Neither is the senior one.`+
 `<div class="hd">Film brings the audience to you</div><p>A close-up can put a viewer six inches from your face. Tiny things become legible — a shift in the eyes, a held breath, a thought you did not say. So you generally do not need to send anything anywhere. You think, you want something, and the lens observes it.</p>`+
 `<div class="hd">Theater reaches the audience</div><p>Row twenty is forty feet away and cannot see your eyes at all. Meaning has to travel — through breath-supported voice, clear consonants, physical clarity, use of the whole stage, and energy sustained across two hours without a second take.</p>`+
 `<div class="hd">The thing people get wrong</div><p>Stage acting is not overacting, and film acting is not underfeeling. A stage performance is exactly as truthful; it simply has to <b>carry</b>. And a film actor can be physically still while something enormous is happening internally.</p>`+
 `<p>It is a difference in <b>how the truth is transmitted</b>, not in how much truth there is.</p>`+
 `<p>Want a lesson on either? I can give you a two-minute camera exercise or a stage projection exercise right now.</p>`,
 src:[],s:['The camera sees everything','Teach me stage presence','How do I stop overacting?']},

{id:'stanislavski',k:'stanislavski stanislavsky method acting strasberg meisner adler system difference emotional memory substitution technique schools',
 a:c=>`Worth untangling, because these get treated as the same thing and they are not.`+
 `<div class="hd">Stanislavsky's System</div><p>Developed in Russia from the late 1800s. A practical framework for building truthful performance out of concrete parts: <b>given circumstances</b>, <b>objective</b> and <b>super-objective</b>, the <b>through-line of action</b>, <b>physical actions</b>, imagination and the <b>Magic If</b>, concentration, observation, and a trained sense of truth.</p>`+
 `<p>Notably, his later work leaned increasingly on <b>physical action</b> — build the behaviour truthfully and the inner life follows — rather than on excavating feeling directly.</p>`+
 `<div class="hd">American "Method acting"</div><p>What happened when the System was interpreted and reshaped in the United States, largely through the Group Theatre and afterwards. It is not one technique — the major teachers disagreed with each other, sometimes sharply. Broadly: <b>Strasberg</b> leaned into affective/emotional memory; <b>Adler</b> pushed imagination and given circumstances over personal recall; <b>Meisner</b> built outward from repetition, impulse and truthful response to a partner.</p>`+
 `<div class="hd">So the honest summary</div><ul><li>Stanislavsky is the root system. Method acting is a family of American descendants</li><li>They are not synonyms, and "the Method" is not one method</li><li>Nothing in Stanislavsky requires you to stay in character off set. That is a later, largely popular-culture association</li></ul>`+
 `<p>Practically: take what works for your brain. Most working actors run a mongrel technique and are entirely unbothered about it.</p>`+
 `<p>I can teach you the Magic If or an objective exercise right now if you want the System hands-on rather than described.</p>`,
 src:[],s:['Give me a Stanislavsky exercise','Teach me about objectives','What is subtext?']},

{id:'filmtv',k:'film actor movie actor tv actor television screen acting become a film actor on camera hollywood',
 a:c=>`The film and TV lane. Here's what the path actually looks like, in the order it matters.`+
 `<div class="hd">1. Get on camera, repeatedly</div><p>Screen acting is its own technique — smaller, stiller, and built on thinking rather than projecting. You learn it by being filmed, watching it back, and being filmed again. An on-camera class beats a stage class for this specific goal.</p>`+
 `<div class="hd">2. Get footage</div><p>This is the gate. Casting will read your resume, but they <b>decide</b> on footage. Student films, shorts, self-produced scenes, even one strong self-tape — anything that shows you working on camera.</p>`+
 `<div class="hd">3. Know your type, honestly</div><p>Screen casting is type-driven to a degree that surprises people. Being clear about what you read as gets you seen far more often than being versatile in theory.</p>`+
 `<div class="hd">4. Build credits from the bottom</div><p>Co-star and day-player roles are how you get seen for guest stars, which is how you get seen for regulars. Nobody skips the ladder.</p>`+
 `<div class="hd">5. Submit constantly, inside your lane</div><p>Self-tape culture means you can audition for work anywhere. The bottleneck is no longer geography — it's materials and consistency.</p>`+
 `<p>Representation comes when you're already working a little, not before. Agents sign people they can send out this month.</p>`,
 src:['profile','apply'],s:['How do I build a reel with no footage?','What is my type?','What is a self-tape?']},

{id:'agentvsmanager',k:'difference between agent and manager what does a manager do agent vs manager both need commission percent',
 a:c=>`Different jobs, and plenty of actors have one without the other.`+
 `<div class="hd">Agent</div><ul><li>Gets you <b>auditions</b>. That's the core function — they have the relationships with casting and they submit you</li><li>Negotiates your deals</li><li>Usually licensed and regulated as an employment agency, and typically works on a <b>commission</b> from work you book</li><li>Carries a large client list, often split into theatrical and commercial divisions</li></ul>`+
 `<div class="hd">Manager</div><ul><li>Works on your <b>career shape</b> — what you're going for, your materials, your type, what you say yes and no to</li><li>Smaller client list, much more hands-on, generally more available to you</li><li>Also commission-based, and can also submit you, though the legal limits on what a manager may do vary by state</li><li>Often the first representation an actor gets, and can help you get an agent later</li></ul>`+
 `<div class="hd">Which do you need?</div><p>If you have materials and just need doors opened: <b>agent</b>. If you're early, unclear on your lane, and need someone building the thing with you: <b>manager</b>. Established actors frequently have both, plus a lawyer on deals.</p>`+
 `<p>Commission rates and exactly what a manager may legally do differ by state and by contract — read anything before you sign, and take a real one to an entertainment lawyer.</p>`+
 `<p><b>Neither charges you upfront.</b> Both get paid when you get paid.</p>`,
 src:['dir'],s:['How do I get an agent?','Tell me about the agency directory','What should I put on my resume?']},

{id:'castingdirector',k:'casting director what does a casting director do associate assistant who decides who casts hires',
 a:c=>`Useful thing to understand early: <b>a casting director does not hire you.</b>`+
 `<div class="hd">What they actually do</div><ul><li>Get the breakdown from production and interpret what the director actually wants</li><li>Put out the call, read submissions, and decide who gets seen</li><li>Run the audition, sometimes give you an adjustment to see if you take direction</li><li><b>Present a short list</b> to the director and producers, who make the final call</li></ul>`+
 `<p>So the casting director is your advocate, not your judge. When they bring you in, they're putting their own taste on the line. That's why a good read sticks even when you don't book — they remember, and they call you for the next thing.</p>`+
 `<div class="hd">The rest of the room</div><ul><li><b>Casting associate</b> — runs sessions, often reads with you, does a lot of the actual reviewing</li><li><b>Casting assistant</b> — schedules, handles submissions and logistics, and is very often the person who becomes the CD in five years. Be decent to them</li><li><b>Director</b> — final creative say on performance</li><li><b>Producer</b> — money, schedule, and sign-off</li></ul>`,
 src:['guarantee','apply'],s:['How does the casting process work?','What is a callback?','How should I behave in the room?']},

{id:'castingprocess',k:'casting process how does casting work start to finish pipeline steps from breakdown to booking',
 a:c=>`Start to finish, here's the whole pipeline.`+
 `<ul><li><b>Production</b> decides it needs actors and sets the budget and schedule</li><li><b>Casting director</b> is hired and talks through the roles with the director</li><li><b>Breakdown</b> goes out — the role descriptions, type, age range, pay, union status, dates</li><li><b>Submissions</b> come in from agents, managers and actors directly</li><li><b>Review</b> — the casting team goes through submissions and picks who to see</li><li><b>Audition</b> — self-tape or in person</li><li><b>Callback</b> — narrowed group, often with an adjustment or a different scene</li><li><b>Producer / director session</b> — the short list reads for the people with final say</li><li><b>Offer and contract</b> — terms, dates, usage, rate</li><li><b>Shoot</b></li></ul>`+
 `<p>Two things worth knowing. Timelines stretch and collapse without warning — weeks of silence then "can you be there Thursday". And decisions get made above the casting director's head constantly, which is why a pass so often has nothing to do with your read.</p>`+
 `<p>On CastSlate your submission enters at the review step — shown <b>full-screen, one at a time</b>, requiring a decision either way.</p>`,
 src:['guarantee','apply','cd'],s:['What does a casting director do?','How will I hear back?','How do I read a casting breakdown?']},

{id:'commercialvsfilm',k:'commercial acting difference film television theatrical commercial audition how is commercial different relatability',
 a:c=>`They're genuinely different skills, and treating them the same is one of the most common early mistakes.`+
 `<div class="hd">Commercial</div><ul><li>You often have <b>seconds</b>. Warmth, energy and clarity have to land almost immediately</li><li>Casting is frequently buying <b>you</b> — your presence and relatability — more than a constructed character</li><li>Auditions are short, often improvised or partly unscripted, sometimes just a slate and a reaction</li><li>Type and look carry a lot of weight, and so does the ability to take a quick adjustment</li></ul>`+
 `<div class="hd">Film and television</div><ul><li>Deeper character and scene work — objective, relationship, stakes, what happened before the scene starts</li><li>Stillness reads. The camera is close and it catches thinking</li><li>Sides are usually real scenes, and they want to see your specific interpretation</li></ul>`+
 `<div class="hd">Theater</div><ul><li>Voice and body have to carry to the back row without losing truth</li><li>Sustained performance across a whole arc, live, every night</li></ul>`+
 `<p>Most working actors do more than one. Just don't bring film stillness to a commercial audition, or commercial brightness to a drama — that mismatch is what casting is reading in the first ten seconds.</p>`,
 src:[],s:['How do I become a commercial actor?','What should I wear to an audition?','What is my type?']},

{id:'voiceover',k:'voiceover voice over vo voice acting animation dubbing demo booth home studio narration audiobook',
 a:c=>`Voiceover is a genuinely separate business — different agents, different auditions, different gear.`+
 `<div class="hd">The lanes</div><ul><li><b>Commercial</b> — brand spots, the most competitive and the best paid per hour</li><li><b>Narration</b> — corporate, e-learning, documentary. Unglamorous and where a lot of steady money lives</li><li><b>Animation and video games</b> — character work, usually needs range and stamina</li><li><b>Audiobooks</b> — long-form, endurance work, its own skill set</li><li><b>Dubbing</b> — sync work over existing performance</li></ul>`+
 `<div class="hd">What you need</div><ul><li><b>A treated space.</b> Not a fancy mic in a bad room — a decent mic in a dead room. Closets and blankets genuinely work</li><li>A <b>demo</b> per lane you're pursuing. Short, professionally produced, and only made once you're actually good enough — a weak demo is worse than none</li><li>The ability to self-direct and self-edit. Nearly everything is recorded and delivered from home</li></ul>`+
 `<p>Rates and usage terms in VO vary enormously — union and non-union, buyout versus usage, broadcast versus internal. Always establish what the recording will be used for before you agree to a fee.</p>`,
 src:[],s:['What is a demo reel?','How do I get an agent?','What do actors get paid?']},

{id:'theater',k:'theater theatre stage acting play musical broadway equity aea open call ecc epa audition monologue',
 a:c=>`Theater has its own path, and it's usually the most accessible one to start on.`+
 `<div class="hd">How you get seen</div><ul><li><b>Open calls and general auditions</b> — many companies hold them, and you don't need representation to attend</li><li><b>Submissions</b> to specific productions, the same as screen work</li><li>Community, fringe and regional theater — real credits, real stage time, real training</li></ul>`+
 `<div class="hd">What to bring</div><ul><li>Two contrasting <b>monologues</b>, roughly a minute each, memorised cold and kept audition-ready year round</li><li>For musicals: <b>16 or 32 bars</b> in your best range, plus sheet music in your key, clearly marked, in a binder</li><li>Headshot and resume, stapled back to back, cut to headshot size</li></ul>`+
 `<div class="hd">The technique difference</div><p>Everything has to carry — voice, body, intention — without inflating into something false. Film asks you to shrink. Stage asks you to fill the room while staying truthful. Actors who can do both are rare and get work.</p>`+
 `<p>Union rules for stage work — Actors' Equity in the US — vary by contract and by house. Check the specific production's terms before you assume.</p>`,
 src:['apply'],s:['How do I prepare a monologue?','Is SAG-AFTRA supported?','How do I get my first credit?']},

{id:'childactor',k:'child actor kid minor young performer teenager parent guardian coogan school work permit under 18 start my child',
 a:c=>`For a young performer the shape of it is different, and most of it is about protection.`+
 `<div class="hd">Non-negotiables</div><ul><li>A <b>parent or legal guardian</b> runs the account and comes to everything</li><li>Work permits, schooling requirements and hour limits are set by <b>state law</b> and vary a lot — check your state before booking anything</li><li>Many states require earnings from a young performer to be protected in a trust account. Ask about it explicitly</li><li>Union productions have specific additional protections for minors, including around digital replicas</li></ul>`+
 `<div class="hd">On CastSlate</div><p>Talent under 18 must register a <b>parent or guardian's email</b> at signup. Minors get no unsupervised access and their contact details are never displayed publicly.</p>`+
 `<div class="hd">The honest advice</div><ul><li>Never pay for representation, "scouting", or mandatory photo packages. This is where families get taken</li><li>Age-appropriate headshots. No styling a child to look older</li><li>Keep it fun and keep school first. Burnout at fourteen is a real thing</li></ul>`+
 `<p>Anything that feels off around a young performer — report it, and I'll put you with a person immediately.</p>`,
 src:['safety','acct'],s:['How do I report something?','Is CastSlate safe?','Talk to a human']},

{id:'singer',k:'singer singing musical theatre vocalist perform music song audition 16 bars book cabaret',
 a:c=>`Singing casting runs on slightly different rails to straight acting.`+
 `<div class="hd">Your book</div><p>A binder of prepared material, in your keys, professionally marked. Aim to cover: an up-tempo, a ballad, something contemporary, something legit or golden-age, and a pop/rock option. <b>16 and 32-bar cuts</b> for each, cut at a musical phrase rather than mid-thought.</p>`+
 `<div class="hd">In the room</div><ul><li>Hand the accompanist clean, taped, marked music and give a tempo. This matters more than people expect</li><li>Pick material that <b>fits your voice and your type</b>, not the song you love most</li><li>They're casting a character who sings. Act the song — the acting is usually what separates the final few</li></ul>`+
 `<div class="hd">If you're crossing over</div><p>Singers moving into acting usually need scene work more than vocal work, and actors moving into musicals usually need a teacher, not just practice. Be honest about which one you are.</p>`,
 src:['profile'],s:['How do I become a theater actor?','How do I prepare a monologue?','What should I put on my resume?']},

{id:'sagrates',k:'sag rate rates pay scale how much does sag pay minimum union rate day rate residuals overtime meal penalty',
 a:c=>`There isn't one SAG-AFTRA rate, and anyone who quotes you a single number is guessing.`+
 `<div class="hd">What decides your rate</div><ul><li><b>Which agreement</b> the production is signed to — theatrical, television, new media, commercials, low-budget tiers, and others each have their own schedule</li><li><b>Your category</b> — background, day performer, weekly, guest star, series regular, stunt, dancer, singer</li><li><b>Budget tier</b> and how the work will be used</li></ul>`+
 `<div class="hd">What sits on top of the base rate</div><p>Overtime, meal penalties, travel, holding, fittings, rehearsal, wardrobe, plus pension and health contributions. And for commercials, session fees are separate from use fees and holding fees.</p>`+
 `<div class="hd">Getting the real number</div><p>Rates and contract terms change, so I won't quote figures at you. <b>SAG-AFTRA publishes current rate sheets by agreement at sagaftra.org</b> — that's the authoritative source. If you're already a member, your local can tell you exactly which agreement covers a specific job.</p>`+
 `<p>On CastSlate, pay is listed in the breakdown on every casting, so you see the terms before you submit rather than after.</p>`,
 src:['apply'],s:['What is union vs non-union?','How do residuals work?','Is this indie film SAG?']},

{id:'residuals',k:'residuals royalties reruns streaming payment after get paid again repeat fees',
 a:c=>`Residuals are payments for the <b>continued use</b> of something you already shot — reruns, streaming, home video, foreign broadcast, and so on. They're separate from what you were paid on the day.</p>`+
 `<div class="hd">Two things people get wrong</div><ul><li><b>"All actors get residuals."</b> Not true. It depends on the agreement, your performer category, how the project is distributed, and your contract</li><li><b>"Streaming has no residuals."</b> Also not true. Streaming residuals exist and their structure has been a central bargaining issue in recent negotiations</li></ul>`+
 `<div class="hd">Not the same as</div><p>Session fees (paid for the work itself), use fees in commercials (paid for a specific run), buyouts (a single payment instead of ongoing use payments), and bonuses.</p>`+
 `<p>Whether a specific job pays residuals, and how much, comes down to the applicable agreement and your contract. <b>Check sagaftra.org or ask your local</b> rather than relying on what someone told you on set.</p>`,
 src:[],s:['What do actors get paid?','What is union vs non-union?','What should I check in a contract?']},

{id:'lowbudget',k:'low budget indie film ultra low budget micro budget short project agreement signatory is this sag student film',
 a:c=>`Really good question, because most early work happens down here.`+
 `<p>SAG-AFTRA has <b>multiple agreements for smaller productions</b> — ultra low budget, moderate low budget, short project, micro-budget and others. Each has its own budget ceiling, its own minimum terms, and its own rules about who can work on it.</p>`+
 `<div class="hd">So "is this indie film SAG?" isn't yes or no</div><p>It depends on:</p><ul><li>Whether the production is a <b>signatory</b> to a SAG-AFTRA agreement at all</li><li><b>Which</b> agreement, which is driven by budget</li><li>Your <b>performer category</b> on that job</li><li>Whether you're a member, and whether Taft-Hartley applies</li></ul>`+
 `<p>SAG-AFTRA itself makes the final determination of which agreement a project falls under — a producer telling you "it's SAG" is not the same as it being signed.</p>`+
 `<div class="hd">Before you say yes</div><ul><li>Ask directly: are you signatory, and under which agreement?</li><li>Get the terms in writing — rate, dates, usage, credit, meals, travel</li><li>If you're a member, clear it with your local first. Working a non-signatory job can have consequences</li></ul>`+
 `<p>For the current tiers and thresholds, go to <b>sagaftra.org</b> — those numbers move.</p>`,
 src:['safety'],s:['What is union vs non-union?','What is Taft-Hartley?','What should I check in a contract?']},

{id:'tafthartley',k:'taft hartley eligible eligibility join sag must join non member how do i become sag eligible vouchers',
 a:c=>`Taft-Hartley is the mechanism that lets a <b>non-member work a union job</b>.`+
 `<p>If a signatory production wants to hire someone who isn't a SAG-AFTRA member, they can file a Taft-Hartley report justifying it. Working under that generally makes you <b>eligible to join</b> — it does not automatically make you a member, and it does not automatically mean you should join right away.</p>`+
 `<div class="hd">Other common routes to eligibility</div><ul><li>Background work under qualifying union conditions, accumulated over time</li><li>Membership in an affiliated performers' union for a qualifying period</li></ul>`+
 `<div class="hd">The decision nobody explains well</div><p>Once you join, you generally <b>can't work non-union</b> under that union's jurisdiction. For a lot of actors, non-union work is where they're building credits and footage — so joining too early can dry up your bookings. There's also a real initiation fee.</p>`+
 `<p>Plenty of working actors stay eligible-but-not-joined for a while on purpose. That's a strategy, not a failure.</p>`+
 `<p>Requirements and fees change and vary — <b>confirm current eligibility rules with SAG-AFTRA directly</b> before making the call.</p>`,
 src:[],s:['What is union vs non-union?','Is this indie film SAG?','What do actors get paid?']},

{id:'aireplica',k:'ai digital replica synthetic performer scan likeness consent deepfake voice clone biometric',
 a:c=>`Worth understanding properly, because it's now standard contract language rather than a hypothetical.`+
 `<div class="hd">The two terms</div><ul><li><b>Digital replica</b> — a digital version of <em>you</em>, made from a scan or existing footage, used to create performance you didn't actually perform</li><li><b>Synthetic performer</b> — a digitally created "person" not based on a specific real performer</li></ul>`+
 `<p>Ordinary digital touch-up — de-aging a shot, cleaning a plate, compositing — is generally not the same thing as creating and using a replica. The distinction matters and it lives in the contract language.</p>`+
 `<div class="hd">What to look for before you sign</div><ul><li><b>Consent</b> — is it specific, informed and separate, or buried in a general clause?</li><li><b>Scope</b> — which project, which uses, how long, and can it be reused in something else?</li><li><b>Compensation</b> — are you paid for the replica's use, not just the scan day?</li><li><b>Ownership changes</b> — what happens if the production is sold?</li><li><b>Biometric data</b> — how is the scan stored, secured and disposed of?</li><li>Extra protections generally apply for <b>minors</b></li></ul>`+
 `<div class="hd">Two things that are not true</div><p>Signing a contract does not automatically hand a producer your likeness forever. And AI use is not automatically prohibited either. It comes down to the agreement covering the production and the specific words in your contract.</p>`+
 `<p>These provisions have changed substantially in recent negotiations — <b>get the current terms from sagaftra.org</b>, and take a real contract to an entertainment lawyer.</p>`,
 src:[],s:['What should I check in a contract?','What is union vs non-union?','Is CastSlate safe?']},

{id:'contract',k:'contract sign agreement terms what should i check before signing usage exclusivity nudity buyout options',
 a:c=>`Read it before you're on set, not after. Educational, not legal advice — a real contract should go to an entertainment lawyer.`+
 `<div class="hd">What to actually look at</div><ul><li><b>Compensation</b> — the rate, when it's paid, and what happens with overtime and overages</li><li><b>Dates</b> — shoot days, plus fittings, rehearsals, travel and holds</li><li><b>Usage</b> — where it runs, in what media, in what territories, for how long</li><li><b>Exclusivity and conflicts</b> — especially in commercials, this can block you from a whole product category</li><li><b>Options and extensions</b> — can they hold you for future seasons or cycles, and on what terms?</li><li><b>Digital replica and AI provisions</b></li><li><b>Nudity, simulated intimacy, stunts</b> — these need specific written terms, and intimacy scenes should have a coordinator</li><li><b>Credit, residuals, buyouts, merchandising, promotional and social media use</b></li><li><b>Image, likeness and voice</b> — how far do the rights go?</li></ul>`+
 `<div class="hd">Red flags</div><p>Perpetual worldwide rights in all media for a day rate. A blanket AI clause with no scope. Any request for money from you. And "just sign, we'll sort the details later".</p>`+
 `<p>Asking for time to read something is completely normal and no legitimate production will hold it against you.</p>`,
 src:['safety'],s:['What about AI and digital replicas?','What do actors get paid?','Is CastSlate safe?']},

{id:'breakdown',k:'breakdown read a casting notice what does it mean casting call language decode role description interpret',
 a:c=>`A breakdown tells you more than it looks like. Here's how to read one.`+
 `<div class="hd">Work through it in this order</div><ul><li><b>Project type and format</b> — feature, short, series, commercial, student film. Sets the tone of everything else</li><li><b>Union status</b> — decides who can even submit</li><li><b>Role size</b> — lead, supporting, day player, co-star, guest star, background</li><li><b>Age range and description</b> — this is <em>playing</em> age, not your birthday</li><li><b>Pay and usage</b> — rate, and where it will run</li><li><b>Dates and location</b> — can you genuinely be there, including fittings?</li><li><b>Submission requirements</b> — sides, self-tape spec, deadline</li></ul>`+
 `<div class="hd">Reading between the lines</div><p>Character descriptions tell you what the team <em>thinks</em> they want. Adjectives are casting direction: "grounded" means don't push, "quirky" means specific choices welcome, "girl/boy next door" is usually commercial warmth. If the description is three lines of backstory and one line of behaviour, they care about the behaviour.</p>`+
 `<div class="hd">Red flags in a breakdown</div><p>No production name, vague or missing pay, an audition at a residence, any fee to submit, or "nudity may be required" with no further detail.</p>`+
 `<p>Paste one in and I'll walk through it with you — I'll only work from what's actually in it, and I'll tell you what's missing.</p>`,
 src:['apply','safety'],s:['Should I submit to this role?','What is my type?','Is this casting a scam?']},

{id:'roletypes',k:'lead supporting day player co-star guest star series regular character actor role size what does it mean principal',
 a:c=>`The vocabulary, quickly — it tells you how much work, how much money, and how much of the story you carry.`+
 `<div class="hd">Screen</div><ul><li><b>Lead</b> — the story is theirs</li><li><b>Supporting</b> — significant arc, serves the lead's story</li><li><b>Day player / co-star</b> — a scene or two, a handful of lines. This is where nearly everyone starts, and it's a real credit</li><li><b>Guest star</b> — a substantial role in an episode, often with its own storyline</li><li><b>Recurring</b> — comes back across episodes</li><li><b>Series regular</b> — contracted for the season</li><li><b>Background / extra</b> — atmosphere, no lines</li><li><b>Principal</b> — a general term for any performer with lines or featured action, as opposed to background</li></ul>`+
 `<div class="hd">"Character actor"</div><p>Not a role size — a description of a career. Character actors are cast for distinctiveness rather than conventional leading looks, and they tend to work steadily for decades. It's a compliment, whatever anyone tells you.</p>`+
 `<p>Don't skip small roles to wait for leads. Co-star credits are how you get seen for guest stars, which is how you get seen for regulars.</p>`,
 src:['apply'],s:['How do I read a casting breakdown?','What is my type?','How do I get my first credit?']},

{id:'headshottypes',k:'commercial theatrical headshot difference what kind of headshot how many looks photographer choose',
 a:c=>`Most actors need <b>two looks</b>, and they do different jobs.`+
 `<div class="hd">Commercial</div><p>Warm, open, approachable. Usually smiling, brighter wardrobe and light, more energy in the eyes. It says: <em>I'd be easy to spend thirty seconds with, and I'd sell your product.</em></p>`+
 `<div class="hd">Theatrical</div><p>Grounded, neutral, more serious. Not grim — <em>thinking</em>. Darker or simpler wardrobe, softer light. It says: <em>there's something going on behind my eyes and you'd want to watch it.</em></p>`+
 `<div class="hd">Choosing a photographer</div><ul><li>Look at their gallery for people who look like <b>you</b>, not just for pretty pictures</li><li>Their shots should look like the person could walk into the room tomorrow — no heavy retouching, no fashion styling</li><li>Ask what's included: number of looks, turnaround, how many retouched finals</li></ul>`+
 `<div class="hd">Choosing your final images</div><p>Pick the ones where your eyes are alive, not the ones where you look best. Casting is buying presence, not symmetry. Ask people who've seen you act, not people who love you.</p>`+
 `<p>Free CastSlate accounts hold one headshot; Premium keeps a main headshot plus unlimited gallery photos, so you can send the commercial look to commercial roles and the theatrical look to drama.</p>`,
 src:['profile'],s:['What are the headshot requirements?','What is my type?','How do I improve my profile?']},

{id:'technique',k:'objective obstacle stakes subtext motivation acting technique meisner stanislavski method how to act choices',
 a:c=>`These four words do most of the heavy lifting in scene work.`+
 `<div class="hd">Objective</div><p>What your character <b>wants from the other person</b>, right now, in this scene. Always active and specific — "to make her admit she lied", not "to be angry". Emotion is a by-product of pursuing something, never the goal itself.</p>`+
 `<div class="hd">Obstacle</div><p>What's in the way. Another person, a rule, a fear, the room. No obstacle, no scene — if getting what you want is easy, there's nothing to watch.</p>`+
 `<div class="hd">Stakes</div><p>What it costs you to fail. Raise the stakes and the scene sharpens automatically. Most flat auditions are flat because the actor decided nothing much was riding on it.</p>`+
 `<div class="hd">Subtext</div><p>What's actually going on underneath the words. People rarely say what they mean, and the gap between line and intention is where most good acting lives.</p>`+
 `<div class="hd">How to practise</div><p>Take one page of sides. Write your objective as a verb sentence. Name the obstacle. Say out loud what happens if you fail. Run it twice with different objectives and notice how much changes without you doing anything "emotional".</p>`+
 `<p>Techniques — Stanislavski, Meisner, Adler, Chubbuck and others — are different routes to the same place: truthful behaviour under imaginary circumstances. Find a teacher whose route works for your brain rather than the most fashionable name.</p>`,
 src:[],s:['How do I act naturally on camera?','How do I prepare a monologue?','Do I need acting school?']},

{id:'natural',k:'act naturally natural on camera stiff wooden nervous look nervous stop overacting be believable authentic',
 a:c=>`"Be natural" is unhelpful direction, so let's make it mechanical.`+
 `<div class="hd">What usually causes stiffness</div><ul><li><b>Watching yourself.</b> Attention on your own performance instead of the other person makes everyone look wooden</li><li><b>Playing the emotion</b> instead of pursuing something. Sadness performed is visible; sadness resisted is moving</li><li><b>Lines not truly memorised.</b> If any part of you is retrieving words, that shows in the eyes</li><li><b>Nothing at stake.</b> No consequence, no life</li></ul>`+
 `<div class="hd">What fixes it</div><ul><li>Put your attention <b>entirely on the other person</b> — the reader, the eyeline, whoever it is. Listening is the whole trick, and it's visible</li><li>Know exactly what you want from them and go after it</li><li>Over-memorise. Lines should be as automatic as your own phone number</li><li>Let yourself be still. The camera is close; small is enough, and thinking reads</li></ul>`+
 `<div class="hd">On nerves</div><p>Nerves aren't the enemy — they're just energy with nowhere to go. Give them somewhere: a specific want, a specific obstacle. And film yourself regularly. Most self-consciousness is unfamiliarity, and it fades with exposure.</p>`,
 src:[],s:['How do I memorize lines?','What is a self-tape?','How do I cry on camera?']},

{id:'cry',k:'cry on camera emotional access tears emotion break down access feelings',
 a:c=>`Chasing tears is the fastest way not to get them.`+
 `<div class="hd">The reframe</div><p>Real crying almost never looks like someone trying to cry. It looks like someone <b>trying not to</b> — and losing. Play the resistance. The audience leans in on the fight, not the collapse.</p>`+
 `<div class="hd">What actually helps</div><ul><li><b>Raise the stakes</b> until the scene genuinely costs something. Emotion follows consequence</li><li><b>Personalise</b> — substitute something of your own that carries real weight. Use it lightly, and don't reopen wounds you can't close after the take</li><li><b>Sensory work</b> — a specific smell, room, voice, object. Specificity does what effort can't</li><li><b>Breath.</b> Held breath and a tight throat physically produce the feeling; forcing your face does not</li></ul>`+
 `<div class="hd">And the professional part</div><p>Nobody is required to cry on cue, and plenty of superb screen actors rarely do. If the tears don't arrive, <b>play the truth of trying to hold it together</b> — that reads as strong or stronger, and it's repeatable across twelve takes, which matters on set.</p>`+
 `<p>If a scene is asking you to go somewhere genuinely difficult, look after yourself around it. That's craft, not weakness.</p>`,
 src:[],s:['How do I act naturally on camera?','What is subtext?','How do I prepare for an audition?']},

{id:'lines',k:'memorize lines memorise learn lines script off book fast forget',
 a:c=>`Memorisation isn't the goal — being free of the words is.`+
 `<div class="hd">What works</div><ul><li><b>Learn the other person's lines too.</b> Your cues are what you're actually responding to, and this is the single biggest upgrade</li><li><b>Record the scene</b> with gaps for your lines and play it while walking around</li><li><b>Chunk by intention</b>, not by sentence. You remember what you want far better than the exact words</li><li><b>Move while you learn.</b> Physical action attaches lines to something other than staring at paper</li><li><b>Write them out by hand</b> once. Slow, and it works</li></ul>`+
 `<div class="hd">For an audition</div><p>You don't have to be perfectly off-book, and holding the sides is completely normal. What you do need is <b>your eyes up</b> for the important moments. Know the first and last line absolutely cold — that's where you're being watched hardest.</p>`+
 `<p>If you go up on set, just ask for the line. Everyone does it, nobody cares, and pretending otherwise wastes takes.</p>`,
 src:[],s:['How do I act naturally on camera?','What is a self-tape?','How do I prepare for an audition?']},

{id:'monologue',k:'monologue prepare choose piece audition speech one minute contrasting',
 a:c=>`Two contrasting pieces, roughly a minute each, kept ready all year. Don't scramble for them the week you need them.`+
 `<div class="hd">Choosing</div><ul><li>Pick something you could <b>plausibly be cast in right now</b>. A 22-year-old doing King Lear is a bad first impression</li><li>Choose a piece with a <b>real other person</b> in it and something to win. Reflective, poetic monologues give you nothing to do</li><li>Avoid the ten pieces every panel has heard 400 times, and avoid anything built on shock</li><li>Read the whole play. They can tell within two lines if you haven't</li></ul>`+
 `<div class="hd">Preparing</div><ul><li>Who are you talking to, where are they, and what do you need from them <b>right now</b>?</li><li>Find the turns — the moments the thought changes direction. A monologue that stays one temperature is dead</li><li>Place the person you're speaking to just off to the side, not on the panel and not on the floor</li><li>Time it. Going long reads as not listening</li></ul>`+
 `<p>Start where the scene is already moving. And when it ends, hold for a beat before dropping out — the last second is often what they remember.</p>`,
 src:[],s:['How do I become a theater actor?','What is subtext?','What should I wear to an audition?']},

{id:'wear',k:'what should i wear audition clothes outfit dress self tape wardrobe colors costume',
 a:c=>`Suggest the character. Don't costume it.`+
 `<div class="hd">General rules</div><ul><li><b>Suggest, don't dress up.</b> A doctor role means clean and neat, not scrubs. A cop role means structured, not a uniform</li><li>Solid colours. No tight patterns, no logos, no stripes that strobe on camera</li><li>Something that <b>fits well and you can forget about</b>. Fidgeting reads as nerves</li><li>Colours that work with your skin and eyes. This is not the moment to experiment</li></ul>`+
 `<div class="hd">On self-tape specifically</div><ul><li>Don't match your top to your background. You'll disappear into the wall</li><li>Blue, green or grey backgrounds are friendly to most people; pure white blows out</li><li>Watch your neckline on a chest-up frame — it's most of what's visible</li></ul>`+
 `<div class="hd">Commercial vs dramatic</div><p>Commercial: brighter, cleaner, friendlier. A solid colour that lifts your face. Dramatic: simpler, darker, less shine — nothing that pulls focus off your eyes.</p>`+
 `<p>If the breakdown specifies wardrobe, follow it exactly. If it doesn't, err toward simple. Nobody has ever lost a role for being too plainly dressed.</p>`,
 src:[],s:['What is a self-tape?','How do I prepare for an audition?','What is my type?']},

{id:'coldread',k:'cold read cold reading sight read unprepared given sides on the spot',
 a:c=>`Cold reading is a skill you can drill, and it's not really about reading.`+
 `<div class="hd">In the thirty seconds you get</div><ul><li>Find <b>who you're talking to and what you want from them</b>. That's it. Nothing else matters as much</li><li>Read the <b>last line</b> first — it tells you where the scene is heading</li><li>Note where the scene turns</li></ul>`+
 `<div class="hd">The technique</div><p>Take the words in during the beat on the page, then <b>deliver them up and out</b>, to the person. Down, up, down, up. Never read and talk at the same time — that's what makes cold reads sound flat.</p>`+
 `<p>Hold the page <b>high</b>, near your eyeline, so your face isn't buried.</p>`+
 `<div class="hd">What they're really testing</div><p>Whether you make a choice fast, whether you listen, and whether you can take an adjustment. Not whether you got every word right. Stumble and keep going — recovering well reads better than reading perfectly.</p>`+
 `<p>Practise with any book: read a paragraph in chunks, eyes up on delivery. Ten minutes a day for two weeks changes it completely.</p>`,
 src:[],s:['How do I prepare for an audition?','How do I memorize lines?','What is a self-tape?']},

{id:'firstjob',k:'first credit first acting job how do i get started booking no credits experience get on set',
 a:c=>`You get the first one by being submittable and being available. That's genuinely most of it.`+
 `<div class="hd">Where first credits actually come from</div><ul><li><b>Student films.</b> Film schools shoot constantly and need actors constantly. Ask for footage in writing before you shoot</li><li><b>Short films and indie shorts</b> — the same, with slightly better sets</li><li><b>Web series and self-produced work.</b> Nobody is stopping you making your own</li><li><b>Community and fringe theater</b> — real stage time, and often the fastest way to be seen live</li><li><b>Background work</b> — paid, and you learn how a set runs, which is worth more than people admit</li></ul>`+
 `<div class="hd">What makes you gettable</div><ul><li>One current headshot, accurate stats, a two-sentence bio, and any training listed</li><li>Reply fast. A huge amount of low-budget casting goes to whoever answered first</li><li>Be genuinely available on the dates before you submit</li></ul>`+
 `<p>Then be excellent to work with — on time, prepared, no drama. The single most reliable source of a second job is the first one.</p>`+
 `<p>On CastSlate you can start submitting the day your profile is up, free, no card. That part costs you nothing but the profile.</p>`,
 src:['profile','apply'],s:['How do I build a reel with no footage?','How do I get started?','What should I put on my resume?']},

{id:'school',k:'acting school do i need training degree conservatory class necessary study university',
 a:c=>`No, a degree isn't required. Training is — but they're not the same thing.`+
 `<div class="hd">What training actually buys you</div><ul><li>Reps. You cannot get good at acting alone in your room</li><li>A teacher who sees you weekly and knows your habits</li><li>Scene partners, and people who'll cast you in their own work later. The network is half the value</li><li>Something true to put on an empty resume</li></ul>`+
 `<div class="hd">Degree vs ongoing class</div><p>A conservatory or BFA gives immersion, time, and a peer group. It's expensive and it's not a requirement — plenty of working actors have neither. <b>An ongoing class with one good teacher for six months</b> will move your work further than three teachers in a year, and costs a fraction.</p>`+
 `<div class="hd">Choosing a class</div><ul><li>Audit first. Always. Any teacher who won't let you is telling you something</li><li>Watch how they treat the weakest actor in the room</li><li>Be suspicious of anything sold on <b>access to casting directors</b> rather than on the work</li><li>You want to be the least experienced person in the room, not the most</li></ul>`+
 `<p>CastSlate runs classes and workshops taught by working professionals if you want somewhere to start — but any consistent class is better than the perfect one you never book.</p>`,
 src:[],s:['Tell me about classes','How do I get my first credit?','What is acting technique?']},

{id:'networking',k:'network networking meet people industry connections events mixers relationships who you know',
 a:c=>`Networking gets a bad name because most people do it as extraction. It works when it isn't.`+
 `<div class="hd">Where relationships actually come from</div><ul><li><b>Your class.</b> The people around you now are the directors, writers and producers casting things in five years. This is genuinely the main one</li><li><b>Sets.</b> Be good to work with and people bring you back</li><li><b>Workshops, screenings, festivals, mixers</b> — go, be curious about other people's work, leave</li><li>Making your own work, which turns you into someone with something to talk about</li></ul>`+
 `<div class="hd">How not to be the person everyone avoids</div><ul><li>Don't ask for anything the first time you meet someone</li><li>Ask about their work and actually listen</li><li>Follow up once, briefly, with something specific</li><li>Support other people's projects publicly. It's noticed</li></ul>`+
 `<div class="hd">The practical bit</div><p>Have something to hand over that isn't a phone number scribbled on a receipt. A card with a <b>QR to your profile</b> means they scan once and have your reel, footage, credits and links — instead of a name they'll misspell in three days. That's what CastSlate's Actor Business Card is for, and Manager Mode surfaces real industry events in NY and LA if you don't know where to start.</p>`,
 src:['card','mm'],s:['What is the Business Card?','What is Manager Mode?','Should I move to LA or NY?']},

{id:'weekly',k:'weekly routine what should i do every week career plan habits consistent 30 day plan schedule discipline',
 a:c=>`A career is built on a weekly rhythm, not on bursts. Here's a workable one.`+
 `<div class="hd">Every week</div><ul><li><b>Submit.</b> Roles you genuinely fit, early rather than on the deadline. Consistency beats volume</li><li><b>Class or scene work.</b> One session minimum. This is the part that compounds</li><li><b>Shoot something.</b> A self-tape, a scene with a friend, an audition tape you keep. Footage is the currency</li><li><b>One relationship</b> — a message, a screening, a workshop, supporting someone's project</li></ul>`+
 `<div class="hd">Every month</div><ul><li>Review your materials honestly. Is the headshot still you? Is the reel still your best work?</li><li>Update credits and skills while you remember them</li><li>Work through a tier of the agency directory rather than blasting everyone at once</li></ul>`+
 `<div class="hd">Every six months</div><p>New footage. New headshots if you've changed. And an honest look at your lane — is what you're submitting for still what you actually read as?</p>`+
 `<p>Two hours a week done for a year beats a heroic month followed by nothing. If you want, tell me your situation — market, experience, what you're going for — and I'll shape a 30-day version around it.</p>`+
 (c.plan==='premium'?`<p>Manager Mode gives you the "one thing this week" if you'd rather not decide it yourself.</p>`:''),
 src:['mm','profile'],s:['What is Manager Mode?','How do I improve my profile?','How do I build a reel with no footage?'],
 sell:c=>({e:'One focused task a week',h:'Manager Mode picks it for you',b:'A weekly check-in on your actual profile — what\'s working, what needs attention, your casting lane, and the single next step.'})},

{id:'money',k:'money finance survive day job income budget taxes as an actor afford support myself',
 a:c=>`General career guidance only — for tax and investment decisions talk to an accountant who works with performers, because the deductions in this business are genuinely specific.`+
 `<div class="hd">The structural reality</div><p>Acting income is lumpy. Nothing for months, then several jobs at once. Budget on your <b>worst</b> month, not your average one.</p>`+
 `<div class="hd">Practical</div><ul><li><b>Flexible day work</b> beats well-paid rigid work. A job that won't let you leave for an audition will cost you more than it pays</li><li><b>Keep every receipt</b> — classes, headshots, reels, subscriptions, travel to auditions can often be deductible. Ask an accountant what applies to you</li><li>Set money aside from every booking for tax. Nobody withholds it for you on a lot of this work</li><li>Build a small buffer before big spends. A cushion buys you the ability to say no</li></ul>`+
 `<div class="hd">Where the money should go</div><p>In rough order: <b>ongoing class</b>, then <b>headshots</b>, then <b>footage</b>. Those three are the ones that change what you can be submitted for. Be careful with anything sold on access rather than skill.</p>`+
 `<p>For scale, CastSlate Premium is $99 a year — about $1.90 a week — and every plan includes every feature, so it doesn't compete with the class budget.</p>`,
 src:['pricing'],s:['Do I need acting school?','What do actors get paid?','How much does CastSlate cost?']},

{id:'etiquette',k:'set etiquette audition room behaviour professional how to behave first day on set what not to do',
 a:c=>`Being easy to work with is a real, bookable skill. It's also the thing that gets you asked back.`+
 `<div class="hd">In the audition room</div><ul><li>Early, not late. Ten minutes, not forty</li><li>Warm to everyone, especially the assistant and the reader</li><li>Don't apologise, don't explain your choice, don't ask to start over more than once</li><li>Take the adjustment <b>fully</b>. That's usually the actual test</li><li>Say thank you and leave. Don't linger</li></ul>`+
 `<div class="hd">On set</div><ul><li>Early is on time. Know where you're meant to be</li><li>Learn the first AD's name and listen to them</li><li>Stay in your eyeline and hit your marks. Continuity is everyone else's problem if you don't</li><li>Phone away and quiet when rolling is called</li><li>Don't give notes to other actors, and don't approach the director with ideas unless invited</li><li>Craft services is not a buffet you clear</li></ul>`+
 `<div class="hd">The one that matters most</div><p>Hurry up and wait is the job. The professional is the person who's still pleasant on hour eleven. Crews talk, and they talk to the people who hire.</p>`,
 src:[],s:['How do I prepare for an audition?','What does a casting director do?','How do I network?']},

{id:'human',k:'human person agent support team talk to someone real person contact speak representative customer service',
 a:c=>`Of course${c.name?', '+c.name:''} — I'll hand this thread to the CastSlate team with everything above attached, so you don't have to repeat yourself.`+
 `<p>They always take these directly: billing disputes and refunds, account deletion, safety reports, and anything involving a minor.</p>`+
 `<p>You can also reach them from the <b>Contact</b> page any time.</p>`,
 src:[],s:[],nocheck:true}
];



/* ═══ CONCEPT GRAPH ════════════════════════════════════════════════
   Not canned lessons. Each concept is a set of teaching COMPONENTS the
   composer assembles at answer time into a quick tip, a standard
   lesson, a deep dive or a masterclass, adapted to level and to what
   the actor has told us about themselves. Adding a concept adds a
   whole family of possible lessons, not one script.                  */
const C=(id,cat,aka,o)=>Object.assign({id,cat,aka},o);
const CONCEPTS=[

/* ── technique ─────────────────────────────────────────────── */
C('objective','Technique','objective want goal intention pursue tactic action',{
 what:`what your character is trying to get <b>from the other person</b> in this scene`,
 why:`it is the only thing that makes a scene move. Without it you are reciting`,
 ex:`"To make her admit she lied" is playable. "To be angry" is not — you cannot do angry`,
 do:`Pick any scene. Write one sentence: <em>I want ___ to ___.</em> Then run it three times using different tactics to get the same thing — charm, guilt, curiosity`,
 look:`the objective stayed fixed and the scene changed completely. That variety is what reads as alive`,
 miss:`trying to <em>show</em> the objective — playing "I am someone who wants this" instead of going after it`,
 fix:`pursue it. If they gave you what you wanted, the scene would end`,
 more:`Mark every point in your sides where your tactic changes. If there is not one, the scene will play flat`,
 take:`An objective is a verb aimed at a person`,
 pro:`Check the scene objective against the super-objective and through-line — shapeless scenes are usually drifted objectives`}),

C('stakes','Technique','stakes consequence cost urgency flat boring low energy matters',{
 what:`what it costs your character to fail, in this scene, in the next two minutes`,
 why:`nearly every flat read is a stakes problem, not a talent problem`,
 ex:`Same three lines played as "mildly inconvenient" and as "this is the last conversation we will ever have" are two different scenes`,
 do:`Run three lines three times, changing only the cost of failure: low, high, unbearable. Do not change your volume`,
 look:`you almost certainly got quieter and more focused as stakes rose, not louder — that is how people actually behave when something matters`,
 miss:`confusing stakes with intensity and pushing the volume up`,
 fix:`raise the cost, not the delivery. Concentration is the tell, not force`,
 more:`Before every audition answer one question: what do I lose if this goes badly? If the honest answer is nothing, invent something`,
 take:`Raise the cost, not the volume`}),

C('subtext','Technique','subtext underneath hidden meaning between the lines not saying doesnt say what they mean',{
 what:`the gap between what the line says and what the character is doing with it`,
 why:`people almost never say what they mean, and most good writing lives in that gap`,
 ex:`"I'm fine" is never information. It is a move — to end the conversation, to punish, to be asked again`,
 do:`Say "You didn't have to do that" four times meaning: I'm touched / you embarrassed me / you crossed a line / please do it again. Same words, no funny voices`,
 look:`the text never changed and the scene changed four times. The words carry almost none of the meaning`,
 miss:`playing the hidden meaning instead of the line — showing us the secret, which kills it`,
 fix:`say the line straight and let the contradiction sit underneath. The audience does the work`,
 more:`Write in the margin what each of your lines is actually <em>doing</em> — accusing, deflecting, testing. Two identical notes in a row means one is wrong`,
 take:`The line is the cover story. Play what is underneath`}),

C('listening','Technique','listen listening react response partner receive hear meisner',{
 what:`genuinely taking in what the other person said before you know how you will answer`,
 why:`most acting problems are listening problems wearing a costume — stiffness, rushing, flatness`,
 ex:`If their delivery cannot change yours from take to take, you were not listening`,
 do:`Run a scene with one rule: you may not decide your response in advance. Let them finish the whole line, last word included, then answer`,
 look:`your timing slowed slightly and got more natural, and you started reacting <em>before</em> you spoke`,
 miss:`performing listening — the visible nodding, the widened eyes. Still self-monitoring`,
 fix:`put attention entirely on them and let your face do whatever it does`,
 more:`Learn the other person's lines as well as your own. Not to say them — so you stop bracing for them`,
 take:`You cannot listen and prepare at the same time`}),

C('presence','Technique','present moment anticipating cue waiting autopilot stale rehearsed dead',{
 what:`nothing has happened yet, as far as you are concerned`,
 why:`an audience can see an actor waiting. The eyes go flat and the line lands a half-beat early`,
 ex:`Over-rehearsed scenes die because the actor stopped receiving and started reciting`,
 do:`Take a scene that has gone stale. Run it with all attention on the other person and none on the words. Let lines arrive late`,
 look:`the awkwardness is the point — that is the feeling of not knowing what happens next`,
 miss:`treating presence as intensity or charisma`,
 fix:`it is not a quality you add. It is what is left when you stop anticipating`,
 more:`In your next self-tape, wait one full second after the reader finishes before you speak. Watch it back`,
 take:`What happens in you before the line is the scene`}),

C('indicating','Technique','overacting indicating too much big hammy showing demonstrating trying too hard forced',{
 what:`showing the audience the label of an emotion instead of living the situation`,
 why:`it is the single most common note in casting, and it comes from not trusting that you are enough`,
 ex:`Your face changes on the important words. You gesture on nouns. You start the emotion before the line that causes it`,
 do:`The flat pass. Read a page completely flat — deliberately boring. Then run it again and only allow a change where you genuinely want something from the other person`,
 look:`the scene got simpler, quieter and faster, because you stopped stopping to feel things at the audience`,
 miss:`trying to fix it by "doing less", which produces a blank`,
 fix:`do less and <em>want more</em>. Restraint without intention is just deadness`,
 more:`Show two takes to someone and ask one question: which one did you believe? Not which was better`,
 take:`Overacting is a confidence problem, not a talent problem`}),

C('naturalism','Technique','natural believable truthful realistic authentic real behaviour behavior',{
 what:`behaving truthfully rather than performing recognisably`,
 why:`the camera in particular reads intention, and audiences detect performance instantly`,
 ex:`Real behaviour is often mundane — people fidget, look away, talk over each other, are boring for a beat`,
 do:`Take one line and do it while genuinely doing a task — folding something, texting. Let the task have priority`,
 look:`you probably stopped decorating the line, because part of your attention was legitimately elsewhere`,
 miss:`equating natural with small or mumbled`,
 fix:`natural means driven by real intention, not turned down. People are extremely loud when it matters`,
 more:`Watch two minutes of a documentary on mute and copy one person's behaviour exactly`,
 take:`Truth is a source, not a volume`}),

C('stillness','Technique','stillness still quiet silence pause do nothing calm restraint',{
 what:`allowing a moment to exist without filling it`,
 why:`silence is where an audience does its own work, and it is what most actors are frightened of`,
 ex:`A held look before a reply tells us more than the reply`,
 do:`Run a scene and add one deliberate three-second silence before your most important line. Do not fill it with a face`,
 look:`it felt far longer to you than it looks on playback. It always does`,
 miss:`filling silence with expression, which converts a pause into a performance`,
 fix:`let the silence be occupied by a thought you do not show us`,
 more:`Watch a scene you admire and time the pauses. They are longer than you would dare`,
 take:`Silence is not empty. It is where the audience leans in`}),

C('impulse','Technique','impulse instinct spontaneity first thought unplanned freedom risky choices',{
 what:`acting on the first true response rather than the one you approved`,
 why:`vetted choices arrive a half-beat late and read as safe`,
 ex:`The take everyone remembers is usually the one where something surprised the actor`,
 do:`Run a scene and commit to the very first impulse each line gives you, even if it seems wrong. No editing mid-take`,
 look:`some of it was bad and one or two moments were better than anything you had planned`,
 miss:`treating impulse as randomness`,
 fix:`impulse only works on top of thorough preparation. Prepare fully, then stop governing`,
 more:`Do one deliberately reckless take on every self-tape. Sometimes send it`,
 take:`Prepare completely, then let go completely`}),

C('emotionprep','Technique','emotional preparation emotion access feelings before the scene cry grief sadness',{
 what:`arriving already in a state, so the scene starts somewhere rather than warming up`,
 why:`most scenes begin mid-life. If you enter neutral, the first third is wasted`,
 ex:`A character walks in having just been humiliated. That happened before "action"`,
 do:`Before your next take, spend sixty seconds on one specific thing that just happened to your character. Not the emotion — the event`,
 look:`the first line landed differently because it was a continuation, not an opening`,
 miss:`working yourself into a feeling and then guarding it, which makes you unable to listen`,
 fix:`prepare the circumstance, not the emotion, and let it be disturbed`,
 more:`Try personalising something of your own — use it lightly, and do not reopen wounds you cannot close after the take`,
 take:`Prepare the event. Let the feeling be a consequence`}),

C('physicality','Technique','physical body movement gesture posture walk hands physicalization behaviour transform',{
 what:`building character from the outside — how they stand, move, take up space`,
 why:`some actors get there faster through the body than through psychology, and it is repeatable on set`,
 ex:`Change the centre of gravity — someone led by the chest is a different person from someone led by the forehead`,
 do:`Walk your character across the room three times: led by the chest, then the head, then the hips. Say one line after each`,
 look:`voice and rhythm changed on their own. The body drags the rest along`,
 miss:`decorating with mannerisms that have no source`,
 fix:`pick one physical fact and let everything follow from it`,
 more:`Observe a stranger for two minutes and steal one specific piece of behaviour, not a type`,
 take:`Change the body and the inner life follows more often than people expect`}),

C('habits','Technique','habit hands fidget smile nervous tic repeat same thing unconscious stop doing',{
 what:`the unconscious things your body does under pressure that were never a choice`,
 why:`they read as anxiety on camera and they flatten variety, because they happen regardless of the scene`,
 ex:`Hands that move on every line, a smile that arrives when you are uncomfortable, an upward inflection that turns statements into questions`,
 do:`Film ninety seconds. Watch it on mute and write down every repeated movement. Then run it again and give your body one real job — hold a cup, keep a hand in a pocket, sit on your hands`,
 look:`the habit needed somewhere to go, not suppressing. Occupying beats forbidding`,
 miss:`trying to stop the habit by monitoring it, which splits your attention and makes it worse`,
 fix:`give the impulse a legitimate physical outlet and put your attention back on the other person`,
 more:`Film it again a week later. Habits return under pressure, so this is maintenance, not a one-off fix`,
 take:`You do not remove a habit. You give it a job`}),

C('chemistry','Technique','chemistry partner connection spark attraction two hander chemistry read together',{
 what:`the visible sense that two people are actually affecting each other`,
 why:`it cannot be performed solo, which is why chemistry reads exist`,
 ex:`Chemistry is usually just genuine, specific attention. It reads as heat because it is rare`,
 do:`With a partner, run a scene where your only job is to notice one new true thing about them every time they speak`,
 look:`you both slowed down and started responding rather than exchanging`,
 miss:`manufacturing intensity, or playing the attraction at the other person`,
 fix:`play wanting something from them and let the audience decide what it means`,
 more:`In a chemistry read, be generous — give them something to play off. Casting is watching how you treat a partner`,
 take:`Chemistry is attention, not electricity`}),

C('deception','Technique','lying deceive hiding secret conceal character who lies knows something',{
 what:`playing a character who is concealing something`,
 why:`most actors play the secret, which tells the audience immediately`,
 ex:`A liar is not trying to look like a liar. They are trying to be believed`,
 do:`Run the scene playing only the cover story, completely committed. Do not let one flicker of the truth out`,
 look:`the tension came from us knowing and you not showing. Suppression is more interesting than leakage`,
 miss:`adding shiftiness, pauses, or a knowing look`,
 fix:`play the effort to be believed. The audience supplies the lie`,
 more:`Try one take where the character almost convinces themselves`,
 take:`Play the cover story, not the secret`}),

C('unaware','Technique','character doesnt know dramatic irony unaware ignorant audience knows',{
 what:`playing someone who does not know what the audience knows`,
 why:`dramatic irony only works if you protect the character's innocence completely`,
 ex:`If you play a hint of foreboding, you have spent the scene's whole charge`,
 do:`Run the scene as though the bad news does not exist. Be actively fine. Have plans`,
 look:`the scene became painful to watch, which is the intended effect`,
 miss:`letting the ending seep backwards into the beginning`,
 fix:`the character has not read the script. Keep it that way`,
 more:`Give them something to look forward to in the scene. Optimism sharpens the irony`,
 take:`Protect what your character does not know`}),

/* ── camera ────────────────────────────────────────────────── */
C('shotsize','Camera','close up closeup wide medium two shot coverage frame size shot scale extreme',{
 what:`how much of you is in frame, which changes how much behaviour is legible`,
 why:`the same performance reads as underplayed in a wide and enormous in a tight single`,
 ex:`Extreme close-up: eyes and breath. Close-up: face and thought. Medium: gesture. Wide: whole-body behaviour and physical intention`,
 do:`Film one line three times — phone at arm's length, at two metres, and across the room. Play it identically each time. Watch back`,
 look:`the wide version disappeared and the tight version looked overplayed. Same performance, three verdicts`,
 miss:`treating scale as a rule, and managing your face instead of playing the scene`,
 fix:`ask the size of the frame, adjust <em>physical scale only</em>, and never adjust the truth underneath`,
 more:`On set, just ask the operator what the size is. Nobody minds and it is a professional question`,
 take:`Change the scale, never the intention`,
 pro:`Also worth tracking how much survives a lens change — a 25mm wide and a 75mm single ask for genuinely different physical economies even at the same framing`}),

C('camerathink','Camera','camera awareness self conscious thinking about the camera lens forget the camera',{
 what:`the divided attention between playing the scene and knowing you are being filmed`,
 why:`the split is visible. It reads as a person checking whether they are doing it right`,
 ex:`Performances that look better in rehearsal than on camera are almost always this`,
 do:`Give yourself one physical task in the take that genuinely requires attention — pouring, buttoning, finding something. Let it be slightly difficult`,
 look:`the self-watching had nowhere to live once part of you was busy`,
 miss:`trying to forget the camera, which is another thing to think about`,
 fix:`do not forget it. Give your attention somewhere better and let the camera be furniture`,
 more:`Rehearse with the phone recording every time, so being filmed stops being an event`,
 take:`You cannot forget the camera. You can be busier than it`}),

C('continuity','Camera','continuity matching action repeat takes coverage consistency same each take',{
 what:`repeating your physical behaviour closely enough that shots can be cut together`,
 why:`if the cigarette is in the other hand, the take is unusable however good it was`,
 ex:`Where you drink, where you turn, when you stand — those need to land on roughly the same words each time`,
 do:`Run a scene twice with one prop and deliberately anchor two actions to two specific lines. Check they match`,
 look:`anchoring to lines rather than to feeling made it repeatable without going mechanical`,
 miss:`believing continuity kills spontaneity`,
 fix:`fix a small number of physical anchors and stay free everywhere else`,
 more:`Watch for the script supervisor's notes on set and treat them as useful, not as criticism`,
 take:`Anchor a few actions to specific lines; improvise the rest`}),

C('eyeline','Camera','eyeline eyes where to look off camera reader look away marks blocking',{
 what:`where your eyes go, and whether it matches the geography of the scene`,
 why:`a wrong eyeline breaks the space instantly, even for a viewer who cannot say why`,
 ex:`In a self-tape, eyeline sits just beside the lens — not into it, unless the brief asks for direct address`,
 do:`Tape a mark beside your camera at your own eye height. Run four lines never letting your eyes drift below it`,
 look:`looking down mid-thought is the most common leak, and it reads as uncertainty`,
 miss:`darting between the lens and the reader`,
 fix:`pick one point and stay disciplined. Wandering eyes read as unprepared`,
 more:`On set, ask where the eyeline is. Always. It is expected`,
 take:`Consistent eyeline builds the room the audience cannot see`}),

C('reaction','Camera','reaction shot listening shot cutaway silent no lines interesting react',{
 what:`the shot of you receiving rather than speaking`,
 why:`it is very often the take that gets used, and most actors switch off in it`,
 ex:`A reaction is not a face. It is a specific thought arriving`,
 do:`Have someone say one sentence to you. React with a specific thought you could write down afterwards — not a mood`,
 look:`nameable thoughts read. Generalised concern does not`,
 miss:`performing a reaction, which becomes a series of expressions`,
 fix:`decide what the line <em>means for you</em> and let your face be a by-product`,
 more:`Film a whole scene as the listener only. Watch it back with the sound off`,
 take:`A reaction shot is a thought, not an expression`}),

C('greenscreen','Camera','green screen vfx cgi imaginary tennis ball nothing there creature motion capture mocap',{
 what:`playing against something that is not there`,
 why:`the eye instantly detects an actor who has not decided exactly what they are seeing`,
 ex:`A tennis ball on a stick is your scene partner. Give it height, distance, weight and intent`,
 do:`Pick a fixed point in the room. Decide precisely: how far, how tall, moving how fast, does it want to hurt you. React to it three times`,
 look:`specificity did the work. Vague fear looks like an actor pretending`,
 miss:`playing generalised awe or terror at nothing in particular`,
 fix:`build the object in detail and treat it as physically real`,
 more:`For motion capture, the same rule plus full-body commitment — everything is being recorded, including what you thought was offstage`,
 take:`Decide exactly what is there, then treat it as real`,
 pro:`In mocap the performance is captured without lens framing, so physical scale stays theatrical while facial capture stays screen-sized. Holding both at once is the actual skill`}),

C('multicam','Camera','sitcom multi camera live audience single camera television theatre hybrid',{
 what:`the hybrid form — theatre timing and size, shot by several cameras, often with an audience`,
 why:`playing it like film kills the comedy; playing it like theatre kills the truth`,
 ex:`Multi-cam wants clean, slightly heightened physical storytelling and immaculate joke timing, still honestly played`,
 do:`Take a comic exchange and run it once at film scale, once at theatre scale, then aim for the middle`,
 look:`the middle version kept the laugh and kept the person`,
 miss:`mugging for the audience`,
 fix:`play the truth, size the delivery, and protect the timing`,
 more:`Learn to hold for a laugh without breaking the scene. It is a technical skill`,
 take:`Theatre body, screen truth, comedy timing`}),

/* ── voice & speech ────────────────────────────────────────── */
C('projection','Voice','projection volume loud carry theatre back row shout breath support',{
 what:`being heard across distance without pushing from the throat`,
 why:`shouting damages the voice within a week and still does not land in row twenty`,
 ex:`Volume comes from breath support and consonants, not from effort in the neck`,
 do:`Hand on your belly, ten breaths where the hand moves and the shoulders do not. Then say one line to someone three metres away, and the same line to someone twenty metres away without shouting`,
 look:`the body organised itself when you aimed further — you stood taller and stopped fidgeting`,
 miss:`confusing projection with volume`,
 fix:`support from the breath, land the final consonants, and aim at a person`,
 more:`Practise in the biggest space you can find with someone raising a hand when they lose a word`,
 take:`Breath carries, consonants land, intention aims`}),

C('inflection','Voice','uptalk inflection voice goes up questions monotone singsong rhythm pace',{
 what:`the melodic shape of how you finish a phrase`,
 why:`upward endings turn statements into requests for approval, which undercuts the character`,
 ex:`"I told him I was leaving?" reads as a person seeking permission`,
 do:`Say five statements and deliberately land each final word <em>down</em>. Then say them again while genuinely deciding something`,
 look:`the downward landing arrived free once you were actually deciding rather than offering`,
 miss:`fixing it mechanically, which produces a flat newsreader`,
 fix:`the inflection follows certainty. Give the character something they are sure of`,
 more:`Record a page of dialogue and listen only to the last word of each line`,
 take:`Uptalk is a confidence tell, not a speech habit`}),

C('mictechnique','Voice','microphone mic technique voiceover booth plosive distance placement recording',{
 what:`how you sit relative to the microphone and what it does to your sound`,
 why:`the mic is a close-up for the voice — it catches the smile, the hesitation, and every plosive`,
 ex:`Slightly off-axis kills the plosives. Too far and the room joins in. Too close and you get proximity boom`,
 do:`Read a sentence at a fist's distance, straight on, then the same sentence angled slightly off the capsule. Listen back on headphones`,
 look:`the off-axis take was cleaner without losing intimacy`,
 miss:`performing at volume as if to a room`,
 fix:`talk to one person at conversational level and let the mic do the reaching`,
 more:`Read a page of a novel on mic daily for a week to build stamina and self-hearing`,
 take:`One person, not an audience. The mic hears the difference`}),

C('accent','Voice','accent dialect voice change regional rp southern irish accent audition',{
 what:`sustaining a speech pattern without it eating your acting`,
 why:`half-learned accents pull all of an actor's attention and flatten the performance`,
 ex:`A believable accent is built from a handful of specific sound shifts plus rhythm, not from an overall impression`,
 do:`Find a native speaker recording of two minutes. Copy one sentence exactly, twenty times, until it is muscle memory. Only then say your own lines in it`,
 look:`imitating a real person beats studying a chart. Rhythm carries more than vowels`,
 miss:`learning an accent from other actors' performances of it`,
 fix:`go to primary sources — real speakers, ideally from the exact region and class`,
 more:`Before an accent audition, do it in the shower, on the phone, ordering coffee. It needs to survive being ignored`,
 take:`Accent is rhythm first, sounds second, and it must be automatic before it is useful`}),

/* ── genre / mode ──────────────────────────────────────────── */
C('comedy','Craft','comedy funny comic timing sitcom laugh joke humour humor',{
 what:`playing the situation completely straight while the audience finds it funny`,
 why:`the moment a character knows they are funny, they stop being`,
 ex:`Comic characters want things desperately and cannot see why nobody else is worried`,
 do:`Take a comic line and play it as though your life depends on being taken seriously`,
 look:`the seriousness is what produced the laugh`,
 miss:`selling the joke — the little lift on the punchline`,
 fix:`throw the punchline away and play the want`,
 more:`Comedy timing is mostly about the beat <em>before</em> the line, not the line`,
 take:`Play it straight and let them laugh`}),

C('shakespeare','Craft','shakespeare classical verse iambic heightened text bard sonnet soliloquy',{
 what:`playing heightened text without either flattening it or intoning it`,
 why:`the verse carries the thinking, and fighting it makes the speech incomprehensible`,
 ex:`The character is working something out in real time. The line endings are where thought turns`,
 do:`Take four lines. Speak them, breathing only at the punctuation, and land lightly on the final word of each line. Then paraphrase the whole thing in your own words`,
 look:`the paraphrase told you what you actually meant, and the verse then carried it without effort`,
 miss:`beautiful, general delivery in a special voice`,
 fix:`argue with someone. Every soliloquy is an attempt to solve a problem`,
 more:`Scan one speech for its stresses, then forget the scansion and let it inform the rhythm`,
 take:`The verse is thought under pressure, not music`}),

C('singingacting','Craft','singing while acting musical theatre song audition 16 bars act the song',{
 what:`playing a character who sings, rather than singing at a panel`,
 why:`in musicals the acting is usually what separates the final few, not the top note`,
 ex:`A song starts because speech has run out. Something happened right before bar one`,
 do:`Speak your lyric as text first, finding the objective. Then sing it with the same intention and no added performance`,
 look:`the phrasing changed on its own once you knew what you wanted`,
 miss:`beautiful vocal delivery aimed at the room`,
 fix:`sing to a person about something urgent`,
 more:`Know the moment immediately before the song. Enter already in it`,
 take:`Act the song, then sing it`}),

C('drunk','Craft','drunk drugged intoxicated impaired playing drunk sick unwell',{
 what:`playing impairment convincingly`,
 why:`actors play the symptoms, which always looks like acting`,
 ex:`A drunk person is spending enormous effort <em>appearing sober</em>. That effort is the performance`,
 do:`Do a simple task — buttoning, threading, pouring — while trying very hard to do it perfectly and being slightly behind`,
 look:`the concentration was funnier and sadder than any slurring`,
 miss:`swaying, slurring, and general sloppiness`,
 fix:`play the fight for control. The audience diagnoses the state`,
 more:`Same principle for grief, fear, exhaustion and illness — play the resistance, not the condition`,
 take:`Play the effort to seem fine`}),

C('grief','Craft','grief crying sadness loss mourning tears without crying devastated',{
 what:`playing loss without performing tears`,
 why:`real grief is intermittent, embarrassing and often absent when expected`,
 ex:`People organise funerals. They make tea. The collapse arrives at the wrong moment, over something small`,
 do:`Play a scene of loss while trying to complete an ordinary practical task. Let the task matter`,
 look:`the moment it broke through was more affecting because it was unwanted`,
 miss:`arriving already devastated and staying there`,
 fix:`play holding it together and let it fail once`,
 more:`If tears will not come, play the resistance — it reads as strong or stronger and it survives twelve takes`,
 take:`Grief is what interrupts, not what fills`}),

C('fear','Craft','fear scared afraid terrified horror scream panic',{
 what:`playing fear without escalating into noise`,
 why:`screaming is the least frightening thing an actor can do`,
 ex:`Frightened people go quiet, still and hyper-attentive. They also try to be reasonable`,
 do:`Play a frightening moment while trying very hard not to alarm someone else in the room`,
 look:`the suppression created tension the shouting version did not have`,
 miss:`starting at maximum and having nowhere to go`,
 fix:`start almost normal. Let the fear leak, and save any break for the very end`,
 more:`Watch real footage of frightened people. There is far less noise than you expect`,
 take:`Fear is contained, not expressed`}),

C('anger','Craft','anger angry rage furious argument shouting quiet anger',{
 what:`playing anger without shouting`,
 why:`volume is the least specific version and it exhausts the audience in ten seconds`,
 ex:`The most frightening angry people are the quietest ones. Control is the threat`,
 do:`Play an argument at half your normal volume. Do not soften the intention. Only lower the sound`,
 look:`it became much more dangerous, and much easier to listen to`,
 miss:`playing angry as a state rather than pursuing something`,
 fix:`anger is a tactic. What are you trying to make them do?`,
 more:`Find one moment of stillness in the middle of the row. That is where the audience leans in`,
 take:`Quiet anger is louder`}),

C('flatcharacter','Craft','psychopath no emotion emotionless villain cold detached blank character',{
 what:`playing a character who does not feel what we would feel`,
 why:`actors play absence, which produces a blank rather than a person`,
 ex:`Such characters usually want things intensely. What is missing is the moral brake, not the desire`,
 do:`Play the scene wanting something very ordinary — to be liked, to finish the conversation, to eat — with complete indifference to the cost`,
 look:`the ordinariness was disturbing precisely because the stakes did not register`,
 miss:`playing "evil", which is a genre, not a person`,
 fix:`play the want with total sincerity and remove only the conscience`,
 more:`Give them one thing they genuinely care about. It makes the rest colder`,
 take:`Play the appetite, not the absence`}),

C('improv','Craft','improvisation improv unscripted make it up commercial improv yes and',{
 what:`building a scene without a script, in agreement with your partner`,
 why:`commercial and comedy casting use it constantly, and it exposes listening instantly`,
 ex:`Accept what they offer, add something specific, and keep the scene's given circumstances intact`,
 do:`With a partner, run sixty seconds where every line must begin by accepting the previous one, then add one new concrete detail`,
 look:`the scene built because nobody negated. Denial kills improv faster than a bad joke`,
 miss:`trying to be funny, or changing the premise you were given`,
 fix:`stay inside the scene and be specific. Specificity is what is funny`,
 more:`In a commercial improv, keep the brand's tone. Off-tone brilliance does not book`,
 take:`Accept, specify, stay in the scene`}),

/* ── psychology ────────────────────────────────────────────── */
C('nerves','Psychology','nerves nervous anxiety stage fright freeze panic shaking blank',{
 what:`the body preparing for something that matters`,
 why:`treating nerves as a fault adds a second problem on top of the first`,
 ex:`Nerves and excitement are physiologically almost identical. The difference is where the attention points`,
 do:`Before your next take: exhale longer than you inhale, six times. Then name out loud exactly what you want from the other person`,
 look:`the energy did not go away. It got a job`,
 miss:`trying to calm down, which makes the nerves the subject`,
 fix:`redirect rather than reduce. Attention on them, not on you`,
 more:`Rehearse under mild pressure deliberately — in front of one person, filmed, timed`,
 take:`Nerves are fuel with nowhere to go. Give them somewhere`}),

C('selfjudge','Psychology','self conscious judging myself watching myself overthinking critical inner voice',{
 what:`monitoring your own performance while performing it`,
 why:`it splits attention, and split attention is visible as a slight delay in the eyes`,
 ex:`Actors describe it as watching themselves from the corner of the room`,
 do:`Run a scene with one instruction: your only job is to get a specific reaction out of the other person. If you notice yourself evaluating, return attention to them`,
 look:`you cannot evaluate and pursue at the same time, so pursuing wins`,
 miss:`trying to silence the inner critic, which is another thing to attend to`,
 fix:`crowd it out with a task rather than fighting it`,
 more:`Do one take you intend to delete. Deliberately unwatched work is often the best`,
 take:`You cannot judge and act simultaneously. Choose the task`}),

C('rejection','Psychology','rejection rejected no callbacks handle disappointment resilience quit discouraged',{
 what:`the ordinary arithmetic of casting`,
 why:`hundreds submit and one books. Everyone else is passed on, including people who were excellent`,
 ex:`Most passes are fit decisions made above the casting director, often before you were seen`,
 do:`After each submission, write one sentence about what you would do differently, then close it. Judge the process, not the outcome`,
 look:`the only controllable inputs are materials, aim and consistency`,
 miss:`treating a pass as feedback on your talent`,
 fix:`treat it as feedback on nothing at all. It usually is`,
 more:`Track submissions and self-tapes per month. That number is yours; bookings are not`,
 take:`Judge your inputs. The outputs are not yours to grade`}),

C('perfection','Psychology','trying too hard impress please perfect approval casting director like me',{
 what:`aiming the performance at the panel instead of at the other character`,
 why:`it is the difference between a read that is impressive and a read that is castable`,
 ex:`Wanting to be liked makes actors smile in the wrong places and soften choices`,
 do:`Before you begin, decide one specific thing you want from the reader. Play only that. Let the panel watch`,
 look:`your choices got sharper because they were no longer negotiating for approval`,
 miss:`treating an audition as an exam you can pass by being good`,
 fix:`they are trying to solve a problem. Be a solution, not a candidate`,
 more:`Afterwards, evaluate only whether you played what you intended`,
 take:`Aim at the character, not the room`}),

C('samesame','Psychology','same performance every time cant vary stuck repeating one note range',{
 what:`the tendency to produce the same read regardless of the material`,
 why:`it is usually a preparation habit, not a limitation of range`,
 ex:`Actors default to their most comfortable rhythm and emotional temperature under pressure`,
 do:`Take a scene and make one deliberately wrong choice — the opposite of your instinct. Play it fully committed`,
 look:`the wrong choice usually revealed something usable, because it broke the default`,
 miss:`working harder inside the same approach`,
 fix:`change the objective, not the intensity`,
 more:`Ask a teacher or a trusted peer what your default is. You cannot see it yourself`,
 take:`Range comes from different wants, not different feelings`}),

/* ── audition ──────────────────────────────────────────────── */
C('theroom','Audition','audition room enter introduce first impression walk in behaviour panel',{
 what:`everything that happens before and after the read`,
 why:`casting is also assessing whether they want you on set for three weeks`,
 ex:`Arrive ready, greet everyone including the reader and the assistant, do not apologise for anything`,
 do:`Practise walking in and saying "hi, I'm ___" with your hands still and weight even. Film it once`,
 look:`the small physical settling reads as confidence far more than anything you say`,
 miss:`explaining yourself — the traffic, the cold, the preparation`,
 fix:`say nothing about your circumstances. Just arrive`,
 more:`If they chat, chat. If they do not, do not fill it`,
 take:`Be easy to be in a room with`}),

C('direction','Audition','taking direction adjustment note redirect change callback director note',{
 what:`being given a new instruction and changing`,
 why:`it is usually the actual test. They already know you can act — they want to know if you can adapt`,
 ex:`"Faster." "She's your sister." "You're lying." Take it fully and immediately`,
 do:`Have someone give you random adjustments on a known scene and run each one without discussion. Ten in a row`,
 look:`the half-adjustments felt safe and read as an inability to take direction`,
 miss:`explaining your original choice before complying`,
 fix:`take it completely, commit, go. Ask nothing unless you genuinely cannot proceed`,
 more:`If you disagree with a director, do their version first, well. Then ask if you can try one more thing`,
 take:`Commit fully to the note. Discussion later, if at all`}),

C('mistakes','Audition','forgot my line mistake stumble recover mess up dried blank',{
 what:`what to do when it goes wrong`,
 why:`how you recover tells them more about working with you than a clean read does`,
 ex:`Go up on a line? Ask for it and continue. Derail completely? "Can I take that again?" once, calmly`,
 do:`Deliberately derail a rehearsed scene and practise recovering without apologising or laughing`,
 look:`the recovery was invisible when you did not comment on it`,
 miss:`apologising, explaining, or laughing it off — that is what they remember`,
 fix:`keep going. Nobody remembers the stumble; everybody remembers the reaction to it`,
 more:`On set, just ask for the line. Everyone does`,
 take:`The mistake costs nothing. The apology costs everything`}),

C('choices','Audition','making choices bold safe interpretation what do they want risky',{
 what:`the specific interpretation you bring rather than a neutral reading`,
 why:`casting sees forty safe versions. They remember a point of view`,
 ex:`Two clearly different takes tell them more about you than twenty identical ones`,
 do:`Prepare a scene with two genuinely different objectives — not two moods. Film both. Send the braver one`,
 look:`the brave version was more specific, not louder`,
 miss:`trying to guess what they want and delivering the average`,
 fix:`decide something. A wrong interesting choice beats a right dull one, and they will redirect you if needed`,
 more:`If the breakdown is vague, that is permission, not a trap`,
 take:`Safe reads do not get remembered. They just do not get complained about`}),

C('chemread','Audition','chemistry read producer session test callback pairing screen test',{
 what:`later-stage auditions where they are testing combinations and confirming a decision`,
 why:`the acting question is mostly settled. Now they are checking fit, ease and pairing`,
 ex:`A chemistry read pairs shortlisted actors. A producer session puts you in front of the people with final say`,
 do:`Prepare as normal, then add one thing: decide how you will be generous to your partner`,
 look:`the actor who makes the other person better is very often the one who books`,
 miss:`competing with your scene partner`,
 fix:`play with them. They are being evaluated as a pair`,
 more:`Wear roughly what you wore to the audition they liked. Continuity of impression is real`,
 take:`At this stage, be easy and be generous`}),

/* ── self-tape ─────────────────────────────────────────────── */
C('tapetech','Self-tape','self tape framing lighting sound background camera height file naming submit technical',{
 what:`the technical floor a tape has to clear`,
 why:`nobody is grading your apartment, but bad sound gets a tape closed in four seconds`,
 ex:`Landscape, eye height, chest-up. Plain wall in blue, grey or beige. Best light in front of you, never behind. Phone close for sound`,
 do:`Set up as above and film ten seconds. Watch it on the smallest screen you own with the volume at half`,
 look:`the two failures are always sound and backlight, and both are free to fix`,
 miss:`buying equipment before fixing distance and lighting direction`,
 fix:`move the phone closer and turn to face the window`,
 more:`Follow the submission instructions exactly — file name, format, order, take count. Getting this wrong reads as careless`,
 take:`Good sound, front light, close framing. Everything else is decoration`}),

C('reader','Self-tape','reader off camera partner scene partner tape who reads eyeline reader',{
 what:`the person feeding you lines off camera`,
 why:`a bad reader flattens your timing and a good one changes the whole tape`,
 ex:`They should be flat, quiet, close to the lens on one side, and never louder than you`,
 do:`Record the same scene with a live reader and then with a recording of the lines. Compare your timing`,
 look:`the live version had real pauses because you were actually receiving`,
 miss:`using a reader who acts, which turns it into their tape`,
 fix:`ask them to be neutral and consistent, and to stay off your side of the frame`,
 more:`If you have no one, record their lines with pauses and play it back — still better than reading in your head`,
 take:`A neutral live reader is worth more than any camera upgrade`}),

/* ── career ────────────────────────────────────────────────── */
C('readyforagent','Career','ready for an agent when should i get representation am i ready',{
 what:`whether you are submittable right now`,
 why:`agents sign people they can send out this month, not people with potential`,
 ex:`Current headshots, footage of some kind, a few credits, clarity about your type, and living in a market they cover`,
 do:`Look at your materials as a stranger. Would you send this person to a casting director you know?`,
 look:`the gap is almost always footage. Everything else people usually have`,
 miss:`waiting until everything is perfect, or approaching with nothing but a headshot`,
 fix:`fix the footage gap first, then approach systematically rather than all at once`,
 more:`A referral from a class, a CD or a current client outperforms any cold submission`,
 take:`Bookable this month, not promising in theory`}),

C('regional','Career','not in la or new york regional market small city outside build career local',{
 what:`building a career outside the two biggest markets`,
 why:`self-tape culture removed most of the geographic bottleneck, but not the local relationships`,
 ex:`Regional film commissions, local commercial markets, regional theatre and industrials all pay and all build credits`,
 do:`Find out what actually shoots within three hours of you — film office listings, local production companies, regional theatres`,
 look:`most people are surprised by the volume, because they were only looking at national boards`,
 miss:`treating a smaller market as a waiting room`,
 fix:`build materials and credits where you are; move into a market with something to show`,
 more:`Being the reliable local professional in a smaller market is a real career, and less crowded`,
 take:`Build where you are, then move with evidence`}),

C('agerange','Career','age range slightly outside submit anyway playing age too old too young',{
 what:`playing age versus actual age`,
 why:`breakdowns describe a look, not a birthday, and the range is usually wider in practice`,
 ex:`If you plausibly read within the range on camera, you are inside it`,
 do:`Ask three people who have seen your footage what age bracket you read as. Compare with what you assume`,
 look:`most actors are wrong about their own playing age by several years, usually downward`,
 miss:`submitting far outside the range and burning credibility with casting`,
 fix:`a year or two either side is fine. Five is not, unless the breakdown is loose`,
 more:`Your headshot must match the age you are submitting as. That is the actual limiting factor`,
 take:`Submit to what you read as, not what your passport says`})
];
const CONCEPT_BY_ID=Object.fromEntries(CONCEPTS.map(c=>[c.id,c]));
const CNAME={objective:'Objective',stakes:'Stakes',subtext:'Subtext',listening:'Listening',presence:'Presence',indicating:'Indicating (overacting)',naturalism:'Naturalism',stillness:'Stillness and silence',impulse:'Impulse',emotionprep:'Emotional preparation',physicality:'Physical character work',habits:'Unconscious habits',chemistry:'Chemistry',deception:'Playing a liar',unaware:'Dramatic irony',shotsize:'Shot size and performance scale',camerathink:'Camera awareness',continuity:'Continuity',eyeline:'Eyeline',reaction:'The reaction shot',greenscreen:'Green screen and motion capture',multicam:'Multi-camera',projection:'Projection',inflection:'Inflection',mictechnique:'Microphone technique',accent:'Accents',comedy:'Comedy',shakespeare:'Shakespeare and heightened text',singingacting:'Acting while singing',drunk:'Playing impaired',grief:'Grief',fear:'Fear',anger:'Anger',flatcharacter:'Characters without conscience',improv:'Improvisation',nerves:'Nerves',selfjudge:'Self-consciousness',rejection:'Rejection',perfection:'Trying too hard',samesame:'Sameness and range',theroom:'The audition room',direction:'Taking direction',mistakes:'Recovering from mistakes',choices:'Making choices',chemread:'Chemistry reads and producer sessions',tapetech:'Self-tape technicals',reader:'Working with a reader',readyforagent:'Being ready for an agent',regional:'Building outside LA and NY',agerange:'Playing age'};
CONCEPTS.forEach(c=>c.name=CNAME[c.id]||c.id);



/* ═══ GLOSSARY — set and industry vocabulary ═══════════════════════
   These are lookups, not lessons. A definition plus the thing nobody
   tells you, and an offer to go deeper if it is worth teaching.      */
const G=(k,d,note,teach)=>({k,d,note,teach});
const GLOSSARY={
 'hold':G('hold avail on hold',`a production asking you to keep dates free while they decide`,`It is not a booking and it is not binding on either side. You can usually accept other work, but tell your agent first.`),
 'first refusal':G('first refusal',`a soft claim on your dates — if someone else wants you on those days, this production gets the chance to confirm or release you`,`Still not a booking. Nothing is real until you have a deal memo or a contract.`),
 'pinned':G('pinned pin',`the same idea in commercial casting — they are interested and want your dates held`,`Being pinned and released is completely routine. It is not a rejection of your work.`),
 'booking':G('booking booked',`confirmed work, with dates and a rate`,`Get it in writing before you turn anything else down.`),
 'deal memo':G('deal memo',`a short written summary of the agreed terms before the full contract`,`Read it. Rate, dates, usage, credit and any nudity or AI provisions should all be on it.`),
 'table read':G('table read',`the cast sitting down together to read the whole script aloud, usually early`,`Producers and network are often listening. Prepare it like a performance, not a rehearsal.`),
 'fitting':G('fitting wardrobe fitting',`a costume session before the shoot`,`It is usually paid, and it is scheduled work. Never treat it as optional.`),
 'callback':G('callback',`a second audition with a narrowed group`,`Wear roughly what you wore the first time. They are confirming an impression.`),
 'producer session':G('producer session',`the round where you read for the people with final say`,`The acting question is largely settled by now. They are checking fit and ease.`,'chemread'),
 'chemistry read':G('chemistry read',`pairing shortlisted actors to see how they play together`,`Be generous. The actor who makes the other one better very often books.`,'chemread'),
 'test':G('test screen test test option',`the final stage, often with a contract signed in advance covering options and terms`,`Read what you sign before the test, not after — those terms bind you if you book.`),
 'series regular':G('series regular',`contracted for the season, in the main cast`,``),
 'guest star':G('guest star',`a substantial role in one episode, often with its own storyline`,``,'roletypes'),
 'co-star':G('co star costar',`a small speaking role, a scene or two`,`This is where nearly everyone starts and it is a real credit.`,'roletypes'),
 'day player':G('day player',`a performer hired by the day for a small speaking role`,``,'roletypes'),
 'under-five':G('under five under-5',`a role with fewer than five lines, mainly a daytime television term`,``),
 'principal':G('principal',`any performer with lines or featured action, as distinct from background`,``),
 'background':G('background extra atmosphere supporting artist',`non-speaking performers filling the world`,`Paid, useful for learning how a set runs, and a separate pipeline from principal casting.`,'extras'),
 'stand-in':G('stand in standin',`someone who stands in your position while the crew lights and sets the shot`,`A genuinely good job for learning cinematography from the inside.`),
 'photo double':G('photo double',`someone shot in place of a principal, usually from behind or in part`,``),
 'upgrade':G('upgrade upgraded',`background work that becomes principal work on the day — you are given a line or featured action`,`It changes your rate and can have union consequences. Make sure it is documented on the day.`),
 'sides':G('sides',`the pages from the script you are reading for`,`Usually one to three pages. You will rarely get the whole script.`,'breakdown'),
 'breakdown':G('breakdown casting notice',`the description of the project and its roles`,``,'breakdown'),
 'coverage':G('coverage',`the different shots the scene is filmed in — masters, singles, over-the-shoulders`,`Your job is to be repeatable enough that they can cut between them.`,'continuity'),
 'master shot':G('master master shot',`the wide take covering the whole scene`,`Physical behaviour reads here. Facial detail does not.`,'shotsize'),
 'two shot':G('two shot 2 shot',`a frame containing two people`,``,'shotsize'),
 'over the shoulder':G('over the shoulder ots',`shot past one actor onto the other`,`Your off-camera performance still matters — you are their eyeline and their timing.`),
 'marks':G('mark marks hitting my mark',`taped positions on the floor you must land on for focus and framing`,`Learn to find them with your feet, not your eyes.`,'eyeline'),
 'mos':G('mos',`a shot recorded without sound`,``),
 'room tone':G('room tone',`a minute of silence recorded on location for the edit`,`Everyone stays completely still. Do not be the person who moves.`),
 'martini':G('martini shot',`the last shot of the day`,``),
 'abby singer':G('abby singer',`the second-to-last shot of the day`,``),
 'call sheet':G('call sheet call time',`the daily schedule — your call time, scenes, location, weather, contacts`,`Read all of it, not just your own line. It tells you what the day will actually be like.`),
 'wrap':G('wrap wrapped',`the end of shooting, for the day or the production`,``),
 'hot set':G('hot set',`a set dressed mid-scene that must not be touched`,`Do not move anything. Not even your own coffee.`),
 'video village':G('video village',`the monitors where director and producers watch`,`Do not go and watch yourself back uninvited.`),
 'first ad':G('first ad assistant director',`the person running the floor and the schedule`,`Learn their name on day one and listen to them.`),
 'script supervisor':G('script supervisor continuity supervisor',`tracks continuity, matching action and script accuracy`,`When they give you a note it is information, not criticism.`,'continuity'),
 'adr':G('adr looping dubbing',`re-recording dialogue in a studio afterwards, synced to picture`,`You are matching your own timing and breath exactly, months later. It is a skill worth practising.`),
 'buyout':G('buyout',`a single payment covering all use, instead of ongoing use payments`,`Common in non-union and some commercial work. Understand what you are giving up.`,'residuals'),
 'session fee':G('session fee',`the payment for the day you actually shot the commercial`,`Separate from use fees and holding fees.`,'pay'),
 'holding fee':G('holding fee',`a payment to keep you exclusive to a product category during a cycle`,``),
 'conflict':G('conflict conflicts exclusivity',`being blocked from working for a competing product`,`Check the category and the term before you accept — it can lock out a whole industry for a year.`,'contract'),
 'scale':G('scale union scale minimum',`the minimum rate under an applicable union agreement`,`There is no single scale — it depends on the agreement, category and budget. Current rates live at sagaftra.org.`,'sagrates'),
 'taft-hartley':G('taft hartley',`the mechanism letting a non-member work a union job`,``,'tafthartley'),
 'epa':G('epa eca ecc equity principal audition',`open Equity auditions for stage work`,`You generally do not need representation to attend. Bring two contrasting monologues and your book if it is a musical.`,'theater')
};

/* ═══ COMPOSER — builds a lesson from concept components ═══════════ */
const OPENERS={
 habit:[c=>`Let's treat this as a habit rather than a flaw — habits are fixable and they are not about talent.`,
        c=>`Good thing to want to fix. And it is almost never a willpower problem.`],
 state:[c=>`The useful counter-intuitive bit first: playing this well is mostly about <b>not</b> playing it.`,
        c=>`Happy to work on this. The instinct most people have here is the thing that gives it away.`],
 diagnostic:[c=>`There is usually one cause underneath that, and it is a common one.`,
             c=>`Worth diagnosing rather than pushing through — here is what is normally happening.`],
 craft:[c=>`Good question. Here is the mechanism, then something to try.`,
        c=>`Let's make this practical rather than theoretical.`],
 vocab:[c=>`Short version first, then why it matters to you.`,
        c=>`Quick definition, then the part nobody explains.`]
};
const pick=a=>a[Math.floor(Math.random()*a.length)];

function compose(c,depth,level,shape){
  const open=pick(OPENERS[shape]||OPENERS.craft)(c);
  const pro=(level==='pro'&&c.pro)?`<p>${c.pro}</p>`:'';
  const S=[];

  if(depth==='standard'){
    S.push({b:`<p>${open}</p><div class="hd">${c.name||'The idea'}</div>`+
             `<p><b>What it is:</b> ${c.what}.</p><p><b>Why it matters:</b> ${c.why}.</p>`+
             (c.ex?`<p>${c.ex}.</p>`:''),cta:`Got it — what do I do?`});
    S.push({b:`<div class="hd">Try this now</div><p>${c.do}.</p>`,cta:`Done`});
    S.push({b:`<div class="hd">What to notice</div><p>${c.look}.</p>`+
             `<div class="hd">The common mistake</div><p>${c.miss} — ${c.fix}.</p>`+pro+
             `<div class="hd">Takeaway</div><p><b>${c.take}.</b></p>`,end:true});
    return S;
  }
  if(depth==='deep'||depth==='masterclass'){
    S.push({b:`<p>${open}</p><div class="hd">The concept</div><p><b>${c.what}</b>.</p><p>${c.why}.</p>`,cta:`Go on`});
    S.push({b:`<div class="hd">An example</div><p>${c.ex}.</p>`+
             `<div class="hd">Where actors go wrong</div><p>${c.miss}.</p><p><b>The correction:</b> ${c.fix}.</p>`,cta:`Give me the exercise`});
    S.push({b:`<div class="hd">Do this now</div><p>${c.do}.</p><p style="opacity:.7">Take your time — tell me when you have run it, or say if it did not work.</p>`,cta:`Done`});
    S.push({b:`<div class="hd">What you should have noticed</div><p>${c.look}.</p>`+pro,cta:`And then?`});
    if(depth==='masterclass'){
      const rel=CONCEPTS.filter(x=>x.cat===c.cat&&x.id!==c.id).slice(0,3);
      S.push({b:`<div class="hd">Where this connects</div><ul>`+
        rel.map(r=>`<li><b>${r.name||r.id}</b> — ${r.what}</li>`).join('')+`</ul>`+
        `<p>Say the name of any of those and we will work on it.</p>`,cta:`Finish it`});
    }
    S.push({b:`<div class="hd">Challenge</div><p>${c.more}.</p>`+
             `<div class="hd">Takeaway</div><p><b>${c.take}.</b></p>`,end:true});
    return S;
  }
  /* quick */
  return [{b:`<p>${open}</p><p><b>${c.what.charAt(0).toUpperCase()+c.what.slice(1)}.</b> ${c.why}.</p>`+
            `<p><b>Try:</b> ${c.do}.</p><p><b>Watch for:</b> ${c.miss} — ${c.fix}.</p>`+
            `<p style="opacity:.72">Say "go deeper" and I will turn that into a proper lesson.</p>`,end:true}];
}

/* ═══ CLASSIFIER ══════════════════════════════════════════════════ */
const SHAPES=[
 [/\b(how do i|how can i|how to|help me)\s+(stop|avoid|quit|get rid of|not|prevent|fix)\b/i,'habit'],
 [/\b(how do i|how can i|how to)\s+(play|act|portray|do|perform|be)\b/i,'state'],
 [/\b(what('?s| is| are| does)|what do you mean by)\b/i,'vocab'],
 [/\bwhy (do|does|am|is|are|did|can'?t|cant)\b/i,'diagnostic']
];
const DEPTHWORDS=[
 [/\b(quick|quickly|short|briefly|in a sentence|one line|tl;?dr|just tell me|simple version)\b/i,'quick'],
 [/\b(teach me everything|masterclass|in depth|in-depth|deep dive|go deep|thoroughly|properly|everything about|full breakdown)\b/i,'masterclass'],
 [/\b(lesson|exercise|coach me|walk me through|work on|train me|teach me|drill)\b/i,'deep']
];
const DOMAIN=/\b(act|acting|actor|actress|perform|performance|scene|scenes|character|audition|casting|camera|tape|self.?tape|role|line|lines|monologue|agent|manager|reel|headshot|slate|sides|breakdown|callback|voice|stage|theat(er|re)|film|tv|television|commercial|improv|union|sag|set|director|shoot|take|takes|read|reading|cry|emotion|nerves|type|credits|resume|booking|rehears)\b/i;

function shapeOf(q){ for(const [re,sh] of SHAPES) if(re.test(q)) return sh; return 'craft'; }
function depthOf(q,shape){
  for(const [re,d] of DEPTHWORDS) if(re.test(q)) return d;
  return shape==='vocab'?'quick':'standard';
}
const GENERIC=new Set(['acting','act','actor','scene','character','lesson','exercise','class','free','quick','teach','give','me','something','another','play','do','work','more']);
function conceptFor(q){
  const toks=norm(q).filter(t=>!GENERIC.has(t)); if(!toks.length) return null;
  let best=null,score=0; const low=q.toLowerCase();
  CONCEPTS.forEach(c=>{
    const keys=new Set((c.aka+' '+c.id).split(' '));
    let sc=0;
    toks.forEach(t=>{ if(keys.has(t)) sc+= t.length>6?2.4:1.7; });
    (c.aka.split(' ')).forEach(k=>{ if(k.length>5&&low.includes(k)) sc+=1.0; });
    sc/=Math.sqrt(toks.length);
    if(sc>score){score=sc;best=c;}
  });
  return score>=0.85?best:null;
}
function glossaryFor(q){
  const low=' '+q.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ')+' ';
  let hit=null,len=0;
  Object.entries(GLOSSARY).forEach(([term,g])=>{
    g.k.split(' ').forEach(k=>{
      if(k.length>2&&low.includes(' '+k+' ')&&k.length>len){hit={term,g};len=k.length;}
    });
  });
  return hit;
}

/* ═══ LEARNER PROFILE ═════════════════════════════════════════════ */
const TELLS=[
 [/\bi (always|often|tend to|keep|constantly) (over.?act|overact|do too much|push)/i,'indicating'],
 [/\bi (freeze|go blank|blank out|lock up)/i,'nerves'],
 [/\bi('m| am)? (so |really |very )?(nervous|anxious|terrified|scared) (before|in|at|about)/i,'nerves'],
 [/\bi overthink|self.?conscious|i judge myself|watching myself/i,'selfjudge'],
 [/\b(good|great|fine|comfortable) (on|at) stage\b.{0,30}\b(bad|terrible|awful|worse|stiff|dead) (on|in front of the) camera/i,'shotsize'],
 [/\bi (can'?t|cannot) cry\b|\bi never cry\b/i,'grief'],
 [/\bmy hands\b|\bi fidget\b|\bi (always )?smile when/i,'habits'],
 [/\bi rush\b|\bi talk too fast\b|\bi speed up\b/i,'presence'],
 [/\bevery (take|read|scene) (looks|sounds|feels) the same\b|\bi have no range\b/i,'samesame'],
 [/\bi (never|have never) acted\b|\bno experience\b|\b(complete|total) beginner\b/i,'BEGINNER'],
 [/\b(\d{1,2})\+? years (of )?(acting|experience|in the business)\b|\bi'?ve been acting for\b|\bprofessional actor\b/i,'PRO']
];
function readTells(text){
  TELLS.forEach(([re,tag])=>{
    if(!re.test(text))return;
    if(tag==='BEGINNER'){st.level='beginner';st.profile.declared='beginner';return;}
    if(tag==='PRO'){st.level='pro';st.profile.declared='pro';return;}
    if(!st.profile.weak.includes(tag))st.profile.weak.push(tag);
  });
}

/* ═══ INTERACTIVE CORRECTION ══════════════════════════════════════ */
const STUCK=/\b(still|didn'?t work|did not work|not working|doesn'?t work|can'?t do|cannot do|no difference|nothing happened|felt weird|felt fake|same as before|worse|i'?m stuck|not sure i)\b/i;
function coachThrough(c){
  if(!c) return `Tell me what specifically happened and I will give you a different angle on it.`;
  return `<p>Good — that is useful information, not a failure.</p>`+
   `<p><b>Do not try to remove it.</b> Trying to remove something is still attention on yourself, and that is usually what produced it.</p>`+
   `<p>Instead: <em>${c.fix}</em>.</p>`+
   `<p>Run it once more and let the thing you did not like exist. Do not fix it, do not fight it — just put your attention on ${c.cat==='Camera'?'the other person and what you want from them':'what you want from the other person'} and let it be there.</p>`;
}

/* ═══ TEACHING LAYER — interactive micro-lessons ═══════════════════
   Each lesson runs as a real exchange: concept -> why -> do it now ->
   what to look for -> challenge -> takeaway. Education first. The
   platform is mentioned at the end, as an offer, never as the point.  */
const LESSONS=[

{id:'film',title:'Film acting: the camera sees everything',mins:2,lane:'Film & TV',
 k:'film acting camera close screen restraint natural no acting hitchcock doing nothing subtle small',
 steps:[
 {b:`<b>Lesson: the camera sees everything.</b>`+
   `<p>On stage you send the performance out to row twenty. On camera the audience is already six inches from your face — so the work is not to send anything anywhere. It is to <b>think, want something, and let the lens catch it</b>.</p>`+
   `<p>There is a line often attributed to Hitchcock — that film acting is the art of not acting. The attribution is loose, so treat it as a teaching idea rather than gospel. The idea underneath it is real: if you keep <em>showing</em> the audience what you feel, they stop believing you.</p>`,
  pro:`<p>Worth noting the scale question is about lens and frame, not depth. A wide two-shot asks for more physical clarity than a tight single. Good screen actors adjust performance size to coverage without changing what they are actually doing.</p>`,
  cta:`Makes sense — what now?`},
 {b:`<b>Try it. Two takes, right now.</b>`+
   `<p>Pick one sentence. Anything. <em>"I told you I was going to be late."</em></p>`+
   `<ul><li><b>Take one</b> — say it and deliberately <b>show the emotion</b>. Let your face do the work. Play hurt, or angry, whichever you like</li><li><b>Take two</b> — say the exact same line, but change nothing on purpose. Instead, think only about <b>what you want from the person you are talking to</b>. Do you want them to apologise? To stop asking? To feel it?</li></ul>`+
   `<p>Do both out loud. Film them on your phone if you can — it is worth it.</p>`,
  cta:`Done both`},
 {b:`<b>What changed.</b>`+
   `<p>In take one you were the sender. You decided what the moment meant and then transmitted it. That is why it reads as performance — the audience has nothing left to do.</p>`+
   `<p>In take two you were <b>pursuing something</b>, and the feeling arrived as a by-product. Your face almost certainly did less, and it almost certainly read as more. That gap is the whole lesson.</p>`+
   `<p>You probably also got stiller without trying. Stillness on camera is not a technique you apply — it is what is left when you stop demonstrating.</p>`,
  cta:`Give me the challenge`},
 {b:`<b>Your challenge this week.</b>`+
   `<p>Take any short scene. Film it twice — once showing, once wanting. Watch both back <b>with the sound off</b>. Count how many times your face changes in each.</p>`+
   `<p>The one with fewer changes is almost always the one you would cast.</p>`+
   `<div class="hd">Takeaway</div><p><b>Play the want, not the feeling.</b> The camera is close enough to see you thinking, so give it something real to watch.</p>`,
  end:true}]},

{id:'objective',title:'Objective: what your character actually wants',mins:3,lane:'Technique',
 k:'objective want action stanislavski scene work intention what does my character want',
 steps:[
 {b:`<b>Lesson: the objective.</b>`+
   `<p>An objective is what your character <b>wants from the other person, in this scene, right now</b>.</p>`+
   `<p>The most common mistake is writing it as a feeling — "to be angry", "to be sad". Those are not playable. You cannot <em>do</em> sad. Write it as something you are trying to get out of somebody:</p>`+
   `<ul><li>To make her admit she lied</li><li>To get him to leave without a scene</li><li>To make them say they still love me</li></ul>`+
   `<p>Active, specific, and aimed at a person.</p>`,
  pro:`<p>Underneath the scene objective sits the super-objective — what the character wants across the whole story — and the through-line that connects them. When a scene feels shapeless it is usually because the scene objective has drifted off the through-line.</p>`,
  cta:`OK, give me the exercise`},
 {b:`<b>Exercise. You need a partner, or a chair.</b>`+
   `<p>Your objective: <b>get them to stay five more minutes.</b> That is it.</p>`+
   `<p>Now — do <b>not</b> play desperate. Instead try three completely different ways of getting it:</p>`+
   `<ul><li>Charm them into staying</li><li>Guilt them into staying</li><li>Make them curious enough to stay</li></ul>`+
   `<p>Same objective. Three different tactics. Say whatever words come. Run each one for about thirty seconds.</p>`,
  cta:`Tried it`},
 {b:`<b>What you were practising.</b>`+
   `<p>You just separated <b>what you want</b> from <b>how you go after it</b>. The objective stayed fixed; the tactics changed. That is what makes a scene feel alive — a person who keeps wanting the same thing and keeps changing approach because the last one did not work.</p>`+
   `<p>Notice you probably felt something in at least one version. You did not aim at the feeling. It showed up because you were busy.</p>`,
  cta:`And the challenge?`},
 {b:`<b>Challenge.</b>`+
   `<p>Take any sides you have. At the top of the page write one sentence: <em>I want ___ to ___.</em> Then underline every moment where your tactic changes.</p>`+
   `<p>If you cannot find a single tactic change, the scene will play flat no matter how well you say the lines.</p>`+
   `<div class="hd">Takeaway</div><p><b>Objective is a verb aimed at a person.</b> Emotion is what happens on the way there.</p>`,
  end:true}]},

{id:'magicif',title:'Stanislavsky: the Magic If',mins:3,lane:'Technique',
 k:'magic if stanislavski stanislavsky given circumstances imagination system exercise',
 steps:[
 {b:`<b>Lesson: the Magic If.</b>`+
   `<p>One of the most useful ideas in Stanislavsky's system, and one of the most misquoted.</p>`+
   `<p>The unhelpful version actors carry around: <em>"How would I feel if this happened to me?"</em> That question sends you hunting for an emotion, which is a dead end.</p>`+
   `<p>The useful version: <b>"What would I do if I were this person, in these exact circumstances?"</b></p>`+
   `<p>It moves you from feeling to <b>action</b> — and action is the only thing an audience can actually see.</p>`,
  pro:`<p>The Magic If only works as well as your given circumstances. Vague circumstances produce vague behaviour. Specify the time, the place, what happened ten minutes ago, and what it costs you to fail — then the If has something to bite on.</p>`,
  cta:`Give me the exercise`},
 {b:`<b>Exercise. Do this standing up.</b>`+
   `<p>The circumstances: you have been waiting somewhere public for <b>ten minutes</b>. The person you are meeting matters to you. Your phone buzzes. The message says they are not coming.</p>`+
   `<p>Now — <b>do not try to feel disappointed.</b> Instead answer three questions with your body, not your face:</p>`+
   `<ul><li>What do you do in the next ten seconds?</li><li>Do you reply, or not?</li><li>Where do you go?</li></ul>`+
   `<p>Play the minute. Out loud, on your feet.</p>`,
  cta:`Done`},
 {b:`<b>What you were practising.</b>`+
   `<p>You were building a performance out of <b>decisions</b> instead of out of a mood. Whatever you felt arrived on its own, because you were solving a real problem in real circumstances.</p>`+
   `<p>That is the difference between imagination and pretending. Pretending starts with the result. Imagination starts with the situation and lets the result happen.</p>`,
  cta:`Challenge me`},
 {b:`<b>Challenge.</b>`+
   `<p>Before your next scene, write the given circumstances out longhand: where, when, what just happened, what you came here to do, what it costs you if it goes wrong.</p>`+
   `<p>Then throw the notes away and just play it. You will be surprised how much stays.</p>`+
   `<div class="hd">Takeaway</div><p><b>Not "how would I feel" — "what would I do."</b> Behaviour first; the feeling follows.</p>`,
  end:true}]},

{id:'listen',title:'Listening: the one that fixes everything else',mins:2,lane:'Technique',
 k:'listen listening react reaction present partner respond meisner',
 steps:[
 {b:`<b>Lesson: listening.</b>`+
   `<p>Most acting problems are listening problems wearing a costume.</p>`+
   `<p>Stiff? You are watching yourself instead of them. Rushing? You are waiting for your cue instead of hearing the line. Flat? You decided how the scene goes before it started.</p>`+
   `<p>Real listening means <b>you do not know exactly what your next line will sound like</b> until you have heard theirs.</p>`,
  pro:`<p>The related trap is listening as a performance — the visible nodding, the widened eyes. That is still self-monitoring. The test is whether their delivery can actually change yours take to take.</p>`,
  cta:`Show me`},
 {b:`<b>Exercise. Thirty seconds.</b>`+
   `<p>Get a partner on the phone, or use any recorded dialogue.</p>`+
   `<p>Rule: <b>you may not decide your response in advance.</b> Let them finish completely — the whole line, including the last word — then answer from what you actually heard.</p>`+
   `<p>If you catch yourself preparing while they talk, stop and start over. Most people last about four seconds the first time.</p>`,
  cta:`I tried it`},
 {b:`<b>What you noticed.</b>`+
   `<p>Two things usually happen. Your timing gets slightly slower and much more natural — because you are actually taking something in. And you find yourself reacting <b>before</b> you speak, which is the part casting is really watching.</p>`+
   `<p>On camera, the reaction shot is often the take they use. You cannot fake having heard something.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Next time you run sides, learn <b>the other person's lines</b> as well as your own. Not to say them — so you know exactly what is coming at you and can stop bracing for it.</p>`+
   `<p>It is the single biggest upgrade most actors can make in a week.</p>`+
   `<div class="hd">Takeaway</div><p><b>You cannot listen and prepare at the same time.</b> Pick listening.</p>`,
  end:true}]},

{id:'present',title:'Being present: stop waiting for your cue',mins:2,lane:'Technique',
 k:'present in the moment anticipating cue waiting rushing autopilot moment to moment',
 steps:[
 {b:`<b>Lesson: presence.</b>`+
   `<p>An audience can see when an actor is <b>waiting</b>. There is a particular stillness to it — the eyes go slightly dead, the body holds, and the line comes out a half-beat early because it was already loaded.</p>`+
   `<p>Presence is not intensity or charisma. It is simply that <b>nothing has happened yet</b> as far as you are concerned.</p>`,
  cta:`How do I practise that?`},
 {b:`<b>Exercise.</b>`+
   `<p>Take a scene you know well — well enough that it has gone stale.</p>`+
   `<p>Run it once with one instruction: <b>put all of your attention on the other person and none on the words.</b> Let lines arrive late if they arrive late. Let a pause be genuinely uncomfortable.</p>`+
   `<p>If you forget a line, good. That is the sound of you no longer being on rails.</p>`,
  cta:`Ran it`},
 {b:`<b>What that does.</b>`+
   `<p>Over-rehearsed scenes go dead because the actor stops receiving and starts reciting. Deliberately breaking the rhythm forces the scene to happen <b>now</b> rather than being replayed.</p>`+
   `<p>The awkwardness you felt is not a mistake. It is the feeling of not knowing what happens next, which is what the audience is paying for.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>In your next self-tape, do one take where you consciously wait <b>one full second</b> after the reader finishes before you speak. Watch it back.</p>`+
   `<p>Nine times out of ten it is the take with life in it.</p>`+
   `<div class="hd">Takeaway</div><p><b>The line is not the scene.</b> What happens in you before the line is the scene.</p>`,
  end:true}]},

{id:'closeup',title:'The close-up: what the lens actually catches',mins:3,lane:'Film & TV',
 k:'close up closeup blinking eyes face frame lens camera awareness mute watch back',
 steps:[
 {b:`<b>Lesson: working in a close-up.</b>`+
   `<p>In a close-up the frame is your face, so the audience has nowhere else to look. Small things become loud: a flick of the eyes, a swallow, a tightened jaw, a repeated blink pattern.</p>`+
   `<p>To be very clear, because this gets taught badly: <b>blinking is not bad and you should never try to stop.</b> An actor suppressing blinks looks like an actor suppressing blinks. The goal is <b>awareness</b>, not control.</p>`,
  pro:`<p>Also worth tracking: eyeline discipline across coverage, how much of your performance survives a lens change from a wide to a 75mm single, and whether your behaviour is repeatable enough to cut. Continuity is a performance skill, not just a script supervisor problem.</p>`,
  cta:`OK, what do I do?`},
 {b:`<b>Exercise. You need a phone and four minutes.</b>`+
   `<p>Film yourself doing a short piece — a few lines, chest-up, framed as a close-up.</p>`+
   `<ol><li>Watch it once <b>normally</b>. Get the reaction out of your system</li><li>Now watch it again <b>with the sound off</b></li></ol>`+
   `<p>On the silent pass, just notice — no judgement yet:</p>`+
   `<ul><li>When do you blink, and what is happening when you do?</li><li>Where do your eyes go when you are not looking at the other person?</li><li>Is there tension in the jaw, the brow, the mouth?</li><li>What is your face doing between lines?</li></ul>`,
  cta:`Watched it back`},
 {b:`<b>What you probably saw.</b>`+
   `<p>Most people find the same two things. There is more facial movement than they thought — small eyebrow work, mouth adjustments, a lot of it decorating the lines rather than meaning anything. And the eyes drift away at exactly the moments they are least sure.</p>`+
   `<p>Here is the useful part: <b>natural blinks tend to land between thoughts</b>, at the end of one and the start of the next. When someone is genuinely thinking, the blink pattern organises itself. You do not have to manage it — you have to actually be thinking.</p>`+
   `<p>So the fix is never "blink less". It is "have a thought".</p>`,
  cta:`Give me the challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Shoot the same piece again with one instruction: think about <b>what you want from the person you are speaking to</b> and nothing else. Do not manage your face at all.</p>`+
   `<p>Watch it on mute again and compare. The second version usually has fewer movements, and the ones left over actually mean something.</p>`+
   `<div class="hd">Takeaway</div><p><b>In a close-up, the audience is watching you think.</b> Awareness of what your face does, not control of it.</p>`,
  end:true}]},

{id:'overacting',title:'How to stop overacting',mins:2,lane:'Technique',
 k:'overacting over acting too much big hammy indicating stop trying too hard subtle',
 steps:[
 {b:`<b>Lesson: overacting is not "too much feeling".</b>`+
   `<p>It is <b>indicating</b> — showing the audience the label of the emotion instead of living the situation. And it almost always comes from one place: not trusting that you are enough without decoration.</p>`+
   `<p>Signs you are indicating:</p>`+
   `<ul><li>Your face changes on the important words</li><li>You gesture on nouns</li><li>You start the emotion before the line that causes it</li><li>You are louder in a close-up than you would be in life</li></ul>`,
  cta:`So what do I do instead?`},
 {b:`<b>Exercise: the flat pass.</b>`+
   `<p>Take a page of sides and read the whole thing <b>completely flat</b>. No colour, no emphasis, no acting at all. Deliberately boring. Get all the way through.</p>`+
   `<p>Now run it again — and this time only allow yourself to change something if <b>you actually want something to change in the other person</b>. Everything else stays flat.</p>`,
  cta:`Did it`},
 {b:`<b>What that strips out.</b>`+
   `<p>The flat pass kills your habitual line readings — the music you had already decided on. What comes back in the second pass is only what is driven by intention.</p>`+
   `<p>Almost always the scene gets simpler, quieter and considerably better. And it usually gets faster, because you stop stopping to feel things at the audience.</p>`,
  cta:`Challenge'`},
 {b:`<b>Challenge.</b>`+
   `<p>Ask someone to watch two takes without telling them which is which. Ask one question: <em>which one did you believe?</em></p>`+
   `<p>Not which was better. Which one they believed. It is a far more honest question and people answer it accurately.</p>`+
   `<div class="hd">Takeaway</div><p><b>Do less, want more.</b> Overacting is a confidence problem, not a talent problem.</p>`,
  end:true}]},

{id:'stage',title:'Stage acting: filling the room without inflating',mins:3,lane:'Theater',
 k:'stage theater theatre projection breath voice presence movement spatial audience live',
 steps:[
 {b:`<b>Lesson: stage scale.</b>`+
   `<p>Row twenty cannot see your eyes. That is the entire technical problem of stage acting, and everything else follows from it.</p>`+
   `<p>What it does <b>not</b> mean is overacting. A good stage performance is exactly as truthful as a good screen performance — it simply has to <b>carry</b>. Truth plus reach, not truth turned up.</p>`+
   `<p><em>Theater reaches the audience. Film brings the audience to you.</em> Same craft, different distance.</p>`,
  pro:`<p>In practice you are managing three variables at once — vocal energy, physical clarity and spatial composition — and adjusting them to the house without letting any of them detach from intention. A 900-seat proscenium and a 60-seat black box ask for genuinely different performances of the same role.</p>`,
  cta:`Give me something to do`},
 {b:`<b>Exercise. Stand up, you need actual space.</b>`+
   `<p><b>1. Breath.</b> Hand on your belly. Breathe so the hand moves and your shoulders do not. Ten breaths. This is where volume comes from — not the throat.</p>`+
   `<p><b>2. Reach.</b> Say one line to an imaginary person <b>three metres</b> away. Now the same line to someone <b>twenty metres</b> away. Do not shout. Support it from the breath and let it travel.</p>`+
   `<p><b>3. Clarity.</b> Same line again — hit the final consonant of every word. Exaggerate it. It will feel absurd and sound perfectly normal from the back.</p>`,
  cta:`Done all three`},
 {b:`<b>What you were training.</b>`+
   `<p>Projection is <b>breath support and consonants</b>, not volume. Actors who push from the throat lose their voice in a week and still cannot be understood in row twenty.</p>`+
   `<p>You probably also noticed your body organised itself when you aimed further — you stood taller and stopped fidgeting. Physical clarity comes free with intention over distance.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Run a monologue in the largest space you can get into — a car park, a hall, an empty room. Have someone stand at the far end and simply raise a hand when they lose a word.</p>`+
   `<p>You will learn more in ten minutes than in a month of practising at conversational volume.</p>`+
   `<div class="hd">Takeaway</div><p><b>Scale up the delivery, never the truth.</b> Breath carries, consonants land, intention does the rest.</p>`,
  end:true}]},

{id:'commercial',title:'Commercial acting: being likeable on purpose',mins:2,lane:'Commercial',
 k:'commercial advert advertising brand product relatable likeable spot audition slate personality',
 steps:[
 {b:`<b>Lesson: commercial is its own craft.</b>`+
   `<p>It is not film acting with a bigger smile. The job is different: in a commercial you are usually <b>not</b> playing a constructed character — you are playing a recognisable, likeable human being in a very small amount of time.</p>`+
   `<p>What they are buying: personality, warmth, energy, clarity, and how you handle the product without it looking like you are handling a product.</p>`,
  pro:`<p>Also learn the business shape, because it changes what a booking is worth: session fee versus use fee, holding fees, conflicts and exclusivity within a product category, and how usage is defined. That is often the difference between a good day and a good year.</p>`,
  cta:`OK, exercise`},
 {b:`<b>Exercise. Phone, thirty seconds.</b>`+
   `<p>Take any object within reach. Now sell nothing — just <b>tell a friend one true thing about your morning</b>, straight down the lens, in under ten seconds. Do it three times.</p>`+
   `<ul><li>Once as if the friend is standing right there</li><li>Once as if they are in a hurry</li><li>Once as if you are slightly amused by the whole thing</li></ul>`+
   `<p>Then pick up the object mid-sentence, keep talking, and put it down. Do not present it. Just use it.</p>`,
  cta:`Filmed it`},
 {b:`<b>What that trains.</b>`+
   `<p>Two things commercial casting is testing constantly. First, whether you can be <b>warm down a lens</b> without becoming a presenter — the "talking to a friend" instruction is the fix for that. Second, whether the product can exist in your hands without your body announcing it.</p>`+
   `<p>The version where you were slightly amused is probably the most castable. Ease reads as confidence, and confidence sells.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Watch five commercials on mute. Look only at the actors' faces in the first two seconds. Notice how much is happening before anyone speaks — that is the audition.</p>`+
   `<p>Then film your own two seconds. Just arriving, being pleased to see someone. That is often the whole job.</p>`+
   `<div class="hd">Takeaway</div><p><b>Commercial casting buys the person, not the performance.</b> Be specific, warm, and quick.</p>`,
  end:true}]},

{id:'selftape',title:'Self-tape: a better take in fifteen minutes',mins:3,lane:'Audition',
 k:'self tape selftape setup lighting sound framing reader eyeline take audition video record',
 steps:[
 {b:`<b>Lesson: self-tapes are won on sound and eyes.</b>`+
   `<p>Not on camera quality, not on background, not on production value. Nobody is grading your apartment.</p>`+
   `<p>The technical bar is low and fixed:</p>`+
   `<ul><li><b>Landscape</b>, phone at eye height, framed chest-up unless told otherwise</li><li>Plain wall. Blue, grey or beige. Do not wear the wall</li><li>Face your best window, or put a lamp <b>behind the phone</b>. Never a window behind you</li><li><b>Get close.</b> Phone mics are directional and distance is what kills tapes</li></ul>`,
  cta:`Got the setup`},
 {b:`<b>Exercise: the two-choice take.</b>`+
   `<p>Take four lines of anything. Set up as above. Then shoot it <b>twice with genuinely different objectives</b> — not different moods. For example: once to get them to forgive you, once to get them to admit they were wrong.</p>`+
   `<p>Eyeline just <b>beside</b> the lens, not into it, unless the brief says direct address.</p>`+
   `<p>Watch both back. Pick the braver one.</p>`,
  cta:`Both shot`},
 {b:`<b>Why two choices and not five takes.</b>`+
   `<p>Actors burn hours doing the same take twenty times, hunting for a clean one. Casting is not looking for clean — they are looking for a <b>point of view</b>. Two distinct choices tells them more about you than twenty identical passes.</p>`+
   `<p>And the brave one is almost always the one to send. Safe reads do not get remembered; they just do not get complained about.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Get a live reader if you possibly can — someone flat, quiet, off-camera, just off your eyeline. Reading against a real person changes your timing more than any lighting fix.</p>`+
   `<p>And slate exactly the way the brief asks. If it does not ask, do not add one.</p>`+
   `<div class="hd">Takeaway</div><p><b>Good sound, close framing, two real choices.</b> Everything else is decoration.</p>`,
  end:true}]},

{id:'slating',title:'How to slate',mins:2,lane:'Audition',
 k:'slate slating name introduce top of tape first impression profile turn',
 steps:[
 {b:`<b>Lesson: the slate is the audition.</b>`+
   `<p>The slate is the few seconds at the top where you say who you are. Actors treat it as admin. Casting treats it as <b>the first and sometimes only impression of you as a person</b>.</p>`+
   `<p>A lot of decisions get made in those three seconds, before a single line is read.</p>`,
  cta:`So how do I do it well?`},
 {b:`<b>Exercise. Film three slates.</b>`+
   `<p>Just your name, straight down the lens.</p>`+
   `<ul><li><b>One</b> — the way you normally would</li><li><b>Two</b> — as if you have just recognised an old friend across a room</li><li><b>Three</b> — as if you are about to tell them something funny</li></ul>`+
   `<p>Take a breath before each one. Do not smile on command — arrive with something already going on.</p>`,
  cta:`Filmed them`},
 {b:`<b>What you will see.</b>`+
   `<p>The first is almost certainly the flattest, because you were doing a task. Two and three have a person in them, because you gave yourself a reason to be there.</p>`+
   `<p>That is the whole trick: <b>have a thought before you speak</b>. It is the difference between a slate that reads as an actor waiting to begin and one that reads as somebody worth watching.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Follow the brief exactly — name, height, agency, profile turn, whatever they ask, in that order. Then look down the lens for <b>one extra beat</b> before you cut.</p>`+
   `<p>That last beat is where they decide whether they like you.</p>`+
   `<div class="hd">Takeaway</div><p><b>Slate as yourself, with something already on your mind.</b> Warm beats polished.</p>`,
  end:true}]},

{id:'coldreading',title:'Cold reading without panicking',mins:2,lane:'Audition',
 k:'cold read reading sight unprepared handed sides on the spot',
 steps:[
 {b:`<b>Lesson: cold reading is not about reading.</b>`+
   `<p>They are testing three things: do you make a choice fast, do you listen, and can you take an adjustment. Getting every word right is not on the list.</p>`+
   `<p>In the thirty seconds you get, find two things only: <b>who you are talking to</b>, and <b>what you want from them</b>. Then read the last line of the scene — it tells you where this is going.</p>`,
  cta:`Give me the technique`},
 {b:`<b>Exercise: down-up-down-up.</b>`+
   `<p>Grab any book. Read a paragraph out loud like this:</p>`+
   `<ul><li>Eyes <b>down</b>, take in a chunk of text silently</li><li>Eyes <b>up</b>, deliver that chunk to an imaginary person</li><li>Repeat</li></ul>`+
   `<p><b>Never read and talk at the same time.</b> Hold the page high, near your eyeline, so your face is not buried.</p>`+
   `<p>Two minutes of this, right now.</p>`,
  cta:`Did it`},
 {b:`<b>Why it works.</b>`+
   `<p>Reading aloud while scanning is what makes cold reads sound flat — your voice follows your eyes instead of your intention. Chunking separates the input from the output, so what comes out is spoken <em>to someone</em> rather than recited off a page.</p>`+
   `<p>It also buys you thinking time that looks like thought rather than panic.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Ten minutes a day for two weeks, any text. Newspaper, cereal box, anything.</p>`+
   `<p>And when you stumble — keep going. Recovering smoothly reads better than reading perfectly, because it shows them what you would be like on set at hour eleven.</p>`+
   `<div class="hd">Takeaway</div><p><b>Take it in, then say it to someone.</b> Never both at once.</p>`,
  end:true}]},

{id:'subtext',title:'Subtext: what people are really doing',mins:2,lane:'Technique',
 k:'subtext underneath meaning not saying between the lines what is really going on',
 steps:[
 {b:`<b>Lesson: subtext.</b>`+
   `<p>People almost never say what they mean. Subtext is the gap between the line and the intention, and most good writing lives in it.</p>`+
   `<p><em>"I'm fine."</em> is almost never information. It is a move — to end the conversation, to punish someone, to be asked again.</p>`+
   `<p>Your job is to decide <b>which move it is</b>, and then play the move rather than the words.</p>`,
  cta:`Exercise please`},
 {b:`<b>Exercise. One line, four intentions.</b>`+
   `<p>The line is: <b>"You didn't have to do that."</b></p>`+
   `<p>Say it four times, meaning four different things underneath:</p>`+
   `<ul><li>I am genuinely touched</li><li>You have embarrassed me</li><li>You have crossed a line and we both know it</li><li>Please do it again</li></ul>`+
   `<p>Do not change the words. Do not "do a voice". Just change what you want.</p>`,
  cta:`Said all four`},
 {b:`<b>What that proves.</b>`+
   `<p>The text was fixed and the scene changed completely four times. That is the whole argument against line readings — the words carry almost none of the meaning.</p>`+
   `<p>It also shows why "how should I say this line?" is the wrong question. The right one is <b>"what am I doing to them by saying it?"</b></p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Take a page of sides and write, in the margin beside each of your lines, what the character is <em>actually</em> doing — accusing, deflecting, testing, apologising without apologising.</p>`+
   `<p>If two lines in a row have the same note, one of them is probably being played wrong.</p>`+
   `<div class="hd">Takeaway</div><p><b>The line is the cover story.</b> Play what is underneath it.</p>`,
  end:true}]},

{id:'stakes',title:'Stakes: why the scene matters',mins:2,lane:'Technique',
 k:'stakes raise the stakes consequence urgency flat scene boring low energy',
 steps:[
 {b:`<b>Lesson: stakes.</b>`+
   `<p>Stakes are <b>what it costs you to fail</b> in this scene. Not in the story — in this scene, in the next two minutes.</p>`+
   `<p>Almost every flat audition is a stakes problem. The actor decided, without noticing, that not much was riding on it. And once nothing is riding on it, no amount of good line work will save the scene.</p>`,
  cta:`How do I fix it?`},
 {b:`<b>Exercise. Same scene, three stakes.</b>`+
   `<p>Take three lines of anything and run them three times, changing only what happens if you fail:</p>`+
   `<ul><li><b>Low</b> — mildly inconvenient. You will get over it by lunch</li><li><b>High</b> — you lose something you care about</li><li><b>Unbearable</b> — this is the last conversation you will ever have with this person</li></ul>`+
   `<p>Do not push the volume up. Just change the cost and let everything else follow.</p>`,
  cta:`Ran all three`},
 {b:`<b>What changed.</b>`+
   `<p>You almost certainly got <b>quieter and more focused</b> as the stakes rose, not louder. That surprises people. High stakes make you concentrate, not shout — think about how you actually speak when something really matters.</p>`+
   `<p>Your listening probably sharpened too. When the cost is real, you need information from the other person.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Before every audition, answer one question in one sentence: <em>what do I lose if this conversation goes badly?</em></p>`+
   `<p>If the honest answer is "nothing much", invent something. The writer left room for you to decide.</p>`+
   `<div class="hd">Takeaway</div><p><b>Raise the cost, not the volume.</b></p>`,
  end:true}]},

{id:'voice',title:'Voice acting: the mic hears everything',mins:2,lane:'Voiceover',
 k:'voice acting voiceover vo mic microphone read copy narration animation booth',
 steps:[
 {b:`<b>Lesson: voice acting is acting with one instrument removed.</b>`+
   `<p>Everything you normally do with face and body has to arrive through breath, pace and intention. That is why "just read it nicely" produces the flat, announcer-ish sound that gets tapes rejected.</p>`+
   `<p>The mic is a close-up for the voice. It catches the smile, the hesitation, the fact that you did not mean it.</p>`,
  cta:`Exercise`},
 {b:`<b>Exercise. Read the same copy three ways.</b>`+
   `<p>Take one sentence of anything — a label, an email, a headline.</p>`+
   `<ul><li><b>Announce</b> it, like a voice on a train platform</li><li><b>Tell</b> it to one specific person sitting across a table</li><li><b>Confide</b> it to that person, like it is slightly private</li></ul>`+
   `<p>Record all three on your phone. Then listen back with your eyes shut.</p>`,
  cta:`Recorded`},
 {b:`<b>What you hear.</b>`+
   `<p>The announce version sounds like a stranger. The other two sound like a human being, because you gave yourself <b>one person to talk to</b> rather than an audience.</p>`+
   `<p>That is the core VO note, and it is given in sessions constantly: <em>talk to one person</em>. Most bad reads are performances aimed at a crowd that is not there.</p>`,
  cta:`Challenge`},
 {b:`<b>Challenge.</b>`+
   `<p>Read a page of a novel out loud every day for a week, on mic, at conversational volume, close to the phone. Listen back to one minute of it.</p>`+
   `<p>You are training two things: stamina, and hearing yourself accurately — which is most of self-directing, and self-directing is most of the job.</p>`+
   `<div class="hd">Takeaway</div><p><b>One person, not an audience.</b> The mic hears the difference.</p>`,
  end:true}]},

{id:'roomnerves',title:'The room: first impressions, direction, and recovering',mins:3,lane:'Audition',
 k:'audition room first impression nerves mistake recover take direction callback adjustment impress',
 steps:[
 {b:`<b>Lesson: what the room is actually assessing.</b>`+
   `<p>Not whether you are brilliant. Whether they can <b>work with you for three weeks</b> and whether you solve their problem.</p>`+
   `<p>Which means the most useful thing you can do walking in is stop trying to impress anyone. Impressing is a performance aimed at the panel. They want a performance aimed at the other character.</p>`,
  cta:`How do I handle the first ten seconds?`},
 {b:`<b>First impression: the thirty-second version.</b>`+
   `<ul><li>Arrive ready. Not warming up in the doorway</li><li>Say hello to everyone, including the reader and the assistant. Especially them</li><li>Do not apologise for anything — not the traffic, not your cold, not your preparation</li><li>If they chat, chat. If they do not, do not fill the silence</li></ul>`+
   `<p><b>Exercise:</b> practise walking into a room and saying "hi, I'm ___" with your hands still and your weight even on both feet. Sounds trivial. Film it once and you will see why it is not.</p>`,
  cta:`And if they give me a note?`},
 {b:`<b>Taking direction — this is usually the real test.</b>`+
   `<p>When they give you an adjustment, they are checking one thing: <b>can you change</b>. So change, fully and visibly. A cautious half-adjustment reads as "cannot take direction", which is the most expensive note in casting.</p>`+
   `<p>Do not explain your original choice. Do not ask three clarifying questions. Take it, commit, go.</p>`+
   `<p><b>Exercise:</b> have someone give you a random adjustment on a scene you know — "faster", "she's your sister", "you're lying" — and run it immediately without discussion. Ten of those in a row.</p>`,
  cta:`What if I mess up?`},
 {b:`<b>Recovering from a mistake.</b>`+
   `<p>Go up on a line? Ask for it and continue. Stumble? Keep going. Genuinely derail? <b>"Can I take that again?"</b> once, said calmly, and then start — no apology, no explanation, no laugh.</p>`+
   `<p>They have watched forty people. Nobody remembers the stumble. Everyone remembers the actor who fell apart afterwards, and everyone remembers the one who was completely unbothered.</p>`+
   `<div class="hd">Takeaway</div><p><b>Be easy to work with, take the note fully, and let mistakes cost you nothing.</b></p>`,
  end:true}]}
];
const LESSON_BY_ID=Object.fromEntries(LESSONS.map(l=>[l.id,l]));
const LESSON_INTENT=[
 [/\b(film|screen|camera|on.?camera) (acting )?(lesson|exercise|class)\b|\bteach me (film|screen|camera)|\bhow (do i|to) act (on|for) camera\b|\bcamera sees\b|\bhitchcock\b|\bart of no acting\b/i,'film'],
 [/\bmagic if\b|\bstanislavsk\w* (exercise|lesson)\b|\bgiven circumstances (exercise|lesson)\b/i,'magicif'],
 [/\b(teach|lesson|exercise).{0,20}\bobjective\b|\bobjective (exercise|lesson)\b|\bwhat does my character want\b/i,'objective'],
 [/\b(teach|lesson|exercise).{0,18}\blisten|\blistening (exercise|lesson)\b|\bhow (do i|to) listen\b/i,'listen'],
 [/\b(present|presence) (exercise|lesson)\b|\bteach me (to be )?present\b|\bstop (anticipating|waiting for my cue)\b|\bin the moment\b/i,'present'],
 [/\bclose.?up (lesson|exercise|acting)\b|\bteach me.{0,20}close.?up\b|\bhow to act in a close.?up\b|\bblink/i,'closeup'],
 [/\bstop overacting\b|\boveracting (lesson|help)\b|\bhow (do i|to) (stop|avoid) overact|\bteach me (how )?to be (more )?(natural|subtle|truthful)\b|\bbe more (natural|subtle) (lesson|exercise)\b|\btoo big\b/i,'overacting'],
 [/\bstage (presence|acting) (lesson|exercise)\b|\bteach me stage\b|\bprojection exercise\b|\btheat(er|re) (lesson|exercise)\b/i,'stage'],
 [/\bcommercial (acting )?(lesson|exercise|class)\b|\bteach me commercial\b/i,'commercial'],
 [/\bself.?tape (lesson|exercise|class)\b|\bteach me.{0,16}self.?tape\b|\bgive me a self.?tape exercise\b/i,'selftape'],
 [/\b(slate|slating) (lesson|exercise)\b|\bteach me (how )?to slate\b|\bhow (do i|should i) slate\b/i,'slating'],
 [/\bcold read(ing)? (lesson|exercise)\b|\bteach me cold read/i,'coldreading'],
 [/\bsubtext (lesson|exercise)\b|\bteach me subtext\b/i,'subtext'],
 [/\bstakes (lesson|exercise)\b|\bteach me stakes\b|\bmy scene(s)? (feel|are|is) flat\b|\braise the stakes\b/i,'stakes'],
 [/\bvoice (acting|over) (lesson|exercise|class)\b|\bteach me voice\b/i,'voice'],
 [/\b(audition|room) (lesson|exercise)\b|\bfirst impression (in|at) (an )?audition\b|\bhow (do i|to) (take|handle) (direction|an adjustment)\b|\brecover(ing)? (after|from) a mistake\b|\bstop trying to impress\b/i,'roomnerves']
];

/* ── retrieval ───────────────────────────────────────────────── */
const STOP=new Set("a an the is are was were be been do does did i im me my mine you your yours it its of to for on in at and or but if so how what when where which who whom that this these those can could would should will shall may might must have has had get got just about with as not no yes please thanks thank hey hi hello there here from than then them they he she we us our there's whats".split(' '));
const SYN={cost:'price',costs:'price',pricing:'price',prices:'price',fee:'price',fees:'price',cheap:'price',expensive:'price',
 subs:'submission',submissions:'submission',submitting:'submit',submitted:'submit',applying:'apply',applied:'apply',application:'apply',applications:'apply',
 pics:'photo',pic:'photo',photos:'photo',picture:'photo',pictures:'photo',images:'photo',image:'photo',headshots:'headshot',
 vids:'video',videos:'video',footage:'video',reels:'reel',showreel:'reel',
 paid:'premium',pro:'premium',member:'membership',memberships:'membership',
 cancelling:'cancel',canceling:'cancel',cancelled:'cancel',unsub:'cancel',unsubscribe:'cancel',
 agents:'agent',agency:'agency',agencies:'agency',manager:'manager',managers:'manager',representation:'agent',rep:'agent',reps:'agent',
 classes:'class',workshops:'workshop',workshop:'class',
 directors:'director',cd:'director',cds:'director',caster:'director',casters:'director',
 callbacks:'callback',shortlisted:'callback',shortlist:'callback',
 kid:'minor',kids:'minor',child:'minor',children:'minor',teen:'minor',teenager:'minor',
 scams:'scam',scammer:'scam',fraud:'scam',
 deleting:'delete',deactivate:'delete',
 benefits:'benefit',unlocks:'unlock',unlocked:'unlock',locked:'unlock',
 selftape:'tape',selftapes:'tape',tapes:'tape',taping:'tape',
 unions:'union',eligible:'eligibility',
 nervous:'nerves',anxious:'nerves',auditions:'audition',auditioning:'audition',
 extras:'extra',background:'extra',
 typecasting:'typecast',types:'type',
 resumes:'resume',cv:'resume',
 emails:'email',notification:'notifications'};
/* ── typo tolerance ────────────────────────────────────────────────
   Someone reading a menu of lessons will mistype one of them. "camear
   sees everything" must not dead-end — a single transposed letter is
   not a different question. We build a vocabulary from everything we
   can answer and edit-distance any unrecognised word back onto it.  */
let VOCAB=null;
function buildVocab(){
  const v=new Set();
  const add=str=>String(str||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ')
    .split(/\s+/).forEach(w=>{if(w.length>=4)v.add(w);});
  /* Seed with ordinary English too, or a mistyped "waht" gets pulled onto
     an acting word instead of onto "what" and the question changes meaning. */
  STOP.forEach(w=>{if(w.length>=4)v.add(w);});
  ('what when where which whose there their they them then than this that will would could should '
  +'about because before after into over under again still where here your yours mine ours '
  +'know need want help make take give show tell find best good long much many time work well '
  +'really every other same different first last next thing things something anything nothing').split(' ').forEach(w=>v.add(w));
  CONCEPTS.forEach(c=>{add(c.aka);add(c.name);add(c.id);});
  KB.forEach(e=>add(e.k));
  LESSONS.forEach(l=>{add(l.k);add(l.title);});
  Object.entries(GLOSSARY).forEach(([t,g])=>{add(t);add(g.k);});
  SMALL.forEach(x=>add(x.id));
  return v;
}
function editDist(a,b,cap){
  if(Math.abs(a.length-b.length)>cap)return cap+1;
  const m=a.length,n=b.length;
  let two=null, prev=Array.from({length:n+1},(_,i)=>i), cur;
  for(let i=1;i<=m;i++){
    cur=new Array(n+1); cur[0]=i; let best=i;
    for(let j=1;j<=n;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      let d=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost);
      /* transposition — by far the most common human typo */
      if(i>1&&j>1&&two&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) d=Math.min(d,two[j-2]+1);
      cur[j]=d; if(d<best)best=d;
    }
    if(best>cap)return cap+1;
    two=prev; prev=cur;
  }
  return prev[n];
}
function despell(text){
  if(!VOCAB)VOCAB=buildVocab();
  let changed=false;
  const out=text.split(/(\s+)/).map(tok=>{
    const w=tok.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(w.length<4||VOCAB.has(w)||STOP.has(w))return tok;
    const cap=w.length<=5?1:2;
    let best=null,bd=cap+1;
    for(const cand of VOCAB){
      if(Math.abs(cand.length-w.length)>cap)continue;
      const d=editDist(w,cand,cap);
      if(d<bd){bd=d;best=cand;if(d===1)break;}
    }
    if(best&&bd<=cap){changed=true;return tok.replace(new RegExp(w,'i'),best);}
    return tok;
  }).join('');
  return changed?out:text;
}

const norm=s=>s.toLowerCase().replace(/[^a-z0-9\s']/g,' ').split(/\s+/).filter(w=>w&&!STOP.has(w)).map(w=>SYN[w]||w);
const KEYS=KB.map(e=>new Set(e.k.split(' ')));

/* intent wins over incidental nouns */
const INTENT=[
 [/\b(not|never|nobody|no one|havent|haven'?t|don'?t|dont)\b.{0,30}\b(hear|heard|hearing|repl|respond|response|answer|back|callback)/i,'noresponse'],
 [/no casting.{0,20}(gets? back|repl|respond)/i,'noresponse'],
 [/\b(what|where)\s+am\s+i\s+doing\s+wrong\b/i,'noresponse'],
 [/\b(ignored|ghosted|no luck)\b/i,'noresponse'],
 [/\b(too old|too late|give up|giving up|wasting my time|should i quit|keep going)\b/i,'encourage'],
 [/\b(castslate|this (site|platform)|your (site|platform|castings|listings))\b.{0,30}\b(fake|real|legit|scam)|\b(fake|real|legit)\b.{0,24}\b(castslate|casting|listing)s?\b|\bare (the )?(castings|listings|roles|jobs) (on here |here )?(fake|real|legit)\b/i,'fake'],
 [/\bscam|\bfraud|\bcon artist|\brip.?off|\bget scammed|\bavoid (a )?scam/i,'scams'],
 [/\bworth it|worth the money|should i (pay|upgrade|subscribe)|why (should i )?pay|convince me\b/i,'worth'],
  [/\b(leave|quit) castslate (completely|entirely|for good)\b|\bdifference between cancel(l?ing)? and delet/i,'cancelvsdelete'],
 [/\b(cancel|cancell?ing)\b(?![^.?!]*\bdelet)(?!.{0,20}\bmy account\b)|\bunsubscribe\b|\bstop (charging|billing|taking) me\b|\bstop (my )?(the )?(payments?|subscription|membership|billing)\b|\b(don'?t|do not|dont) want (castslate )?premium\b|\bno longer want (my )?(premium|subscription|membership)\b|\bstop paying\b|\bhow do i stop my subscription\b|\bturn off auto.?renew\b/i,'cancel'],
  [/\b(next|my) billing date\b|\bwhen (will i be|am i) charged\b|\bhow much am i paying\b|\bchange (my )?(payment method|card)\b|\bupdate (my )?card\b|\bresubscribe\b|\brestart (my )?(premium|membership|subscription)\b|\bdo i still have premium\b|\bwhy (did|has|is) my premium\b[^.?!]{0,24}\b(disappear|gone|stopped|missing|not working)|\bwhen does (my|it) renew\b/i,'billinginfo'],
 [/\b(charged|double.?charg|billed twice|refund|money back)\b/i,'refund'],
 [/\b(talk|speak|chat|connect) (to|with) (a |an )?(human|person|someone|agent|rep|real)/i,'human'],
 [/\b(delete|close|remove) (my )?account\b/i,'delete'],
  [/\bjust (don'?t|dont|do not) want to pay\b|\bdon'?t want to be charged\b/i,'cancel'],
 [/\b(can'?t|cannot|unable to) (log ?in|sign ?in|access my account)\b/i,'login'],
 [/\bfree (vs|versus|or) premium|difference between free and (premium|paid)\b/i,'freevp'],
 [/\bwhy (can'?t|cant) i (apply|submit)|only (one|1) (submission|casting)|weekly (limit|cap)|used (up )?my submission/i,'cap'],
 [/\bhow much (is|does|are) (castslate|premium|it|this|the membership)|what does (it|castslate|premium|this) cost|what'?s the price|membership cost/i,'pricing'],
 [/\bhow (do|can) i get (an? )?(agent|manager|represent)/i,'agent'],
 [/\bhow (do|to) (i )?(record|shoot|make) (a )?self.?tape|self.?tape tips\b/i,'selftape'],
 [/\bwhat (are|is) (the )?sides\b/i,'sides'],
 [/\bhow (long|soon).{0,24}(hear|wait|respond|reply)\b/i,'callback'],
 /* teaching + theory intents */
 [/\b(give|teach|show) me (a |an |another )?(free |quick |short |mini |\d+.?minute )?(acting |film |screen )?(lesson|class|exercise)\b|\bteach me (something|acting|to act)\b|\bfree (acting )?lesson\b|\bwhat lessons\b|\banother lesson\b|\bcan you teach\b/i,'lessons'],
 [/\b(film|screen|camera) (acting )?(vs\.?|versus|compared to|and) (stage|theat(er|re))|\b(stage|theat(er|re)) (acting )?(vs\.?|versus|compared to) (film|screen|camera)|\bdifference between (film|screen) and (stage|theat)/i,'filmvsstage'],
 [/\bstanislavsk|\bmethod acting\b|\bstrasberg\b|\bmeisner\b|\bstella adler\b|\bemotional memory\b|\baffective memory\b/i,'stanislavski'],
 /* industry intents */
 [/\b(film|movie|tv|television|screen) actor\b|\bhow (do|can) i become a (film|movie|tv|television|screen) actor\b|\bact in (films?|movies|tv)\b/i,'filmtv'],
 [/\bvoice actors?\b/i,'voiceover'],
 [/\bdo i (really )?need an agent\b|\bhow (do|can) i find an agent\b|\bfind an agent (using|on|through)\b/i,'agent'],
 [/\bhow much (do|does) (actors?|an actor|performers?) (get paid|make|earn)\b|\bactor (pay|salary|day rate)\b|\bwhat do actors get paid\b/i,'pay'],
 [/\bis castslate free\b|\bfree account\b|\bhow much (is|does) castslate\b|\bcastslate cost\b/i,'pricing'],
 [/\bwhat does (castslate )?premium (do|include|get me|give)\b|\bwhat('|)s (in|included in) premium\b|\bpremium features\b/i,'freevp'],
 [/\bwhat (does|is) (my )?type mean\b|\bfind my type\b|\bwhat('|)s my type\b|\bcasting lane\b|\btypecast/i,'type'],
 [/\bwhat should my headshot look like\b|\bgood headshot\b|\bheadshot (tips|advice)\b/i,'headshottypes'],
 [/\bwhat is (a |the )?slate\b|\bhow (do|should) i slate\b|\bslating\b/i,'slate'],
 [/\b(difference between|vs\.?|versus)\b.{0,14}\b(agent|manager)\b|\bagent (vs|versus|or) (a )?manager|\bwhat (does|do) (a )?manager(s)? do\b/i,'agentvsmanager'],
 [/\bwhat (is|does) (a |an )?casting director\b|\bwho (decides|casts|hires)\b|\bcasting (associate|assistant)\b/i,'castingdirector'],
 [/\bhow (does|do) casting work|casting process|from breakdown to|start to finish\b/i,'castingprocess'],
 [/\b(commercial).{0,26}(different|vs\.?|versus|compared).{0,20}(film|tv|television|theatrical)|\b(film|theatrical).{0,26}(vs\.?|versus).{0,16}commercial\b|\bhow (is|are) commercial(s)? (acting )?different/i,'commercialvsfilm'],
 [/\bvoice ?over\b|\bvoice acting\b|\banimation (voice|acting)\b|\baudiobook|\bdubbing\b/i,'voiceover'],
 [/\b(theater|theatre|stage) (actor|acting|auditions?)\b|\bbroadway\b|\bequity\b|\bopen call\b|\bhow do i become a (theater|theatre|stage) actor/i,'theater'],
 [/\bchild actor|\bmy (son|daughter|kid|child)\b|\byoung performer|\bwork permit|\bcoogan\b|\bunder ?18 (actor|perform)/i,'childactor'],
 [/\bsinger|\bsinging\b|\bmusical theat|\b(16|32).?bar|\bmy book\b|\baccompanist\b/i,'singer'],
 [/\bresiduals?\b|\broyalt|\breruns\b/i,'residuals'],
 [/\bhow much (does|do) (sag|the union|actors?) (pay|make|get)|\bsag.?(aftra )?(rate|scale|minimum)|\bwhat (is|are) scale\b/i,'sagrates'],
 [/\btaft.?hartley|\bsag.?eligib|\beligible to join|\bhow do i join sag|\bmust ?join\b/i,'tafthartley'],
 [/\b(ultra|moderate)? ?low.?budget\b|\bmicro.?budget\b|\bshort project agreement\b|\bis (this|it) (a )?sag\b|\bsignator/i,'lowbudget'],
 [/\bdigital replica|\bsynthetic performer|\bai (clause|protection|provision|scan)|\bdeepfake|\bbiometric|\bscan my (face|likeness|body)/i,'aireplica'],
 [/\b(check|read|look at|sign).{0,18}\bcontract\b|\bcontract (terms|clause|language)\b|\bbefore i sign\b|\bexclusivity\b|\bbuyout\b/i,'contract'],
 [/\b(read|understand|interpret|decode).{0,16}\b(breakdown|casting (call|notice))\b|\bwhat does (this|the) breakdown\b|\bshould i submit to this\b/i,'breakdown'],
 [/\b(day player|co.?star|guest star|series regular|supporting role|leading role|character actor|principal)\b|\bwhat does (lead|supporting) mean\b/i,'roletypes'],
 [/\b(commercial|theatrical) headshot\b|\bwhat kind of headshot|\bhow many (headshots|looks)\b|\bheadshot photographer\b/i,'headshottypes'],
 [/\b(objective|obstacle|stakes|subtext)\b|\bmeisner|\bstanislavski|\bthe method\b|\bacting technique\b|\bmake (a |strong )?choices?\b/i,'technique'],
 [/\b(act|acting|look|be) (more )?natural|\bstop (looking|being) (nervous|stiff|wooden)|\bwooden\b|\boveracting\b|\bbelievable on camera\b/i,'natural'],
 [/\bhow do i cry\b|\bcry on (camera|cue)\b|\bcrying scene|\baccess (my )?emotion/i,'cry'],
 [/\bmemori[sz]e|\blearn (my )?lines\b|\boff.?book\b|\bforget (my )?lines\b/i,'lines'],
 [/\bmonologue/i,'monologue'],
 [/\bwhat (should|do) i wear\b|\bwhat to wear\b|\bwardrobe (for|to) (an? )?(audition|self.?tape)\b|\boutfit for/i,'wear'],
 [/\bcold read/i,'coldread'],
 [/\b(do i need|is) (acting )?(school|training|a degree|conservatory)\b|\bshould i (go to|study at) (acting )?school|\bdrama school\b/i,'school'],
 [/\bfirst (acting )?(credit|job|role|gig)\b|\bhow do i get (my )?first\b|\bno credits at all\b/i,'firstjob'],
 [/\bnetwork(ing)?\b|\bmeet (people|casting directors|industry)\b|\bmake connections\b/i,'networking'],
 [/\b(every|each) week\b|\bweekly routine\b|\b(30|60|90).?day plan\b|\bwhat should i (be )?do(ing)? (every|each)\b|\bcareer plan\b/i,'weekly'],
 [/\b(money|finances?|income|budget|day job|survive|afford|taxes)\b.{0,30}\bactor\b|\bhow do actors (survive|afford|live|pay rent)\b|\bactor (taxes|deductions)\b/i,'money'],
 [/\b(set|audition|room) etiquette\b|\bhow (should|do) i (behave|act) (on set|in the room)\b|\bfirst day on set\b|\bprofessional behaviou?r\b/i,'etiquette'],
 [/\bhow (do|can) i become an actor\b|\bwant to (be|become) an actor\b|\bget into acting\b|\bstart acting\b|\bno experience at all\b|\bcomplete beginner\b/i,'beginner']
];
/* Ranked "did you mean" over everything teachable, by shared words. */
function nearestTopics(q){
  const toks=new Set(norm(despell(q)));
  if(!toks.size)return [];
  const cand=[];
  LESSONS.forEach(l=>cand.push({label:l.title,words:norm(l.title+' '+l.k)}));
  CONCEPTS.forEach(c=>cand.push({label:'Teach me '+c.name.toLowerCase(),words:norm(c.name+' '+c.aka)}));
  Object.keys(GLOSSARY).forEach(t=>cand.push({label:'What is a '+t+'?',words:norm(t+' '+GLOSSARY[t].k)}));
  const scored=cand.map(c=>{
    let n=0;c.words.forEach(w=>{if(toks.has(w))n+= w.length>6?2:1;});
    return {label:c.label,n};
  }).filter(x=>x.n>=2).sort((a,b)=>b.n-a.n);
  const seen=new Set();
  return scored.filter(x=>!seen.has(x.label)&&seen.add(x.label)).slice(0,3).map(x=>x.label);
}
const OFFTOPICFALLBACK=['How does CastSlate work?','What does Premium include?','Talk to a human'];

/* where a polished flagship lesson covers the same ground as a concept */
const FLAGSHIP_FOR={listening:'listen',indicating:'overacting',shotsize:'closeup',objective:'objective',
 subtext:'subtext',stakes:'stakes',presence:'present',projection:'stage',tapetech:'selftape',
 theroom:'roomnerves',direction:'roomnerves',mistakes:'roomnerves',camerathink:'film',
 mictechnique:'voice',comedy:'commercial',reader:'selftape'};

function think(text,c){
  for(const s of SMALL) if(s.re.test(text.trim())) return {small:s};
  for(const [re,id] of LESSON_INTENT) if(re.test(text)) return {lesson:id};
  /* Refusals run on the ORIGINAL words. Spell-correcting first would drag
     "who won the game" onto an acting term and smuggle an off-topic
     question past the scope filter. */
  for(const d of DECLINE) if(d.re.test(text)) return {decline:d};
  /* nothing matched literally — try again with obvious typos corrected */
  if(!c||!c.__retry){
    const fixed=despell(text);
    if(fixed!==text){
      const r=think(fixed,Object.assign({},c,{__retry:1}));
      if(r&&!r.miss&&!r.decline)return Object.assign(r,{corrected:fixed});
    }
  }

  /* generic "teach me something" with no topic -> the menu */
  if(/\b(give|show) me (a|an|another|the)?\s*(free |quick |short |mini )?(acting )?(lesson|class)\b|\bteach me (something|acting|to act)\b|\bwhat lessons\b|\banother lesson\b|\bcan you teach me\b/i.test(text)
     && !conceptFor(text)) { const m=KB.find(e=>e.id==='lessons'); if(m) return {entry:m}; }

  /* an explicit request to be taught, at an explicit depth, beats a canned answer */
  const explicit=DEPTHWORDS.find(([re])=>re.test(text));
  if(explicit){
    const cc=conceptFor(text);
    if(cc){
      const d=explicit[1], sh=shapeOf(text);
      if(d==='quick'||d==='masterclass') return {teach:{c:cc,depth:d,shape:sh}};
      const f=FLAGSHIP_FOR[cc.id];
      if(f&&LESSON_BY_ID[f]) return {lesson:f};
      return {teach:{c:cc,depth:'deep',shape:sh}};
    }
  }
  for(const [re,id] of INTENT) if(re.test(text)){ const e=KB.find(x=>x.id===id); if(e) return {entry:e}; }
  const toks=norm(text); if(!toks.length) return {miss:true};
  const shape=shapeOf(text), depth=depthOf(text,shape);

  /* exact industry vocabulary */
  const gl=glossaryFor(text);
  if(gl&&(shape==='vocab'||/\bwhat|\bmean|\bdefine\b/i.test(text))) return {gloss:gl,shape};

  /* a teaching-shaped question goes to the concept graph first */
  if(shape==='habit'||shape==='state'||shape==='diagnostic'||depth==='deep'||depth==='masterclass'){
    const c=conceptFor(text);
    if(c) return {teach:{c,depth:depth==='quick'?'standard':depth,shape}};
  }

  let best=null,score=0; const low=text.toLowerCase();
  KB.forEach((e,i)=>{
    let s=0;
    toks.forEach(t=>{ if(KEYS[i].has(t)) s+= t.length>6?2.2:1.6; });
    e.k.split(' ').forEach(k=>{ if(k.length>5&&low.includes(k)) s+=.8; });
    s/=Math.sqrt(toks.length);
    if(s>score){score=s;best=e;}
  });
  if(best&&score>=0.8) return {entry:best};

  /* nothing canned fits — compose from the concept graph */
  const c2=conceptFor(text);
  if(c2) return {teach:{c:c2,depth,shape}};
  if(gl) return {gloss:gl,shape};

  /* valid actor question with no concept match: still teach, from principles */
  if(DOMAIN.test(text)) return {principles:{shape,depth,q:text}};
  return {miss:true};
}

/* generic teaching frame for a legitimate question with no mapped concept */
function principlesLesson(shape,q){
  const frames={
   habit:{h:`Treating it as a habit`,b:`<p>Habits under pressure are almost never willpower problems, so do not try to suppress it.</p>`+
     `<ol><li><b>See it.</b> Film ninety seconds and watch on mute. Write down exactly when it happens and what is going on in the scene at that moment</li><li><b>Give the impulse a job.</b> Suppression splits your attention; occupation does not. Hold something, sit on your hands, give your body a real task</li><li><b>Move your attention.</b> Put it entirely on the other person and what you want from them, and let the thing exist</li><li><b>Re-film.</b> Compare. It usually reduces on its own once the attention moved</li></ol>`},
   state:{h:`Playing it truthfully`,b:`<p>The general rule for playing any state — drunk, frightened, grieving, lying, in love — is the same, and it is counter-intuitive:</p>`+
     `<p><b>Play the effort to appear normal.</b> Real people in extreme states are mostly trying to function. The audience diagnoses the state from the effort.</p>`+
     `<ol><li>Decide what the character wants in the scene, regardless of their state</li><li>Give them an ordinary task to complete</li><li>Play the want and the task. Let the state interfere</li><li>Allow one moment where it breaks through, near the end</li></ol>`},
   diagnostic:{h:`What is usually causing it`,b:`<p>Most performance problems trace back to one of four things, and it is worth checking them in this order:</p>`+
     `<ol><li><b>Attention.</b> Are you watching yourself instead of the other person?</li><li><b>Intention.</b> Do you know exactly what you want from them in this scene?</li><li><b>Stakes.</b> Does anything actually cost you if you fail?</li><li><b>Preparation.</b> Are the lines automatic enough that you are free?</li></ol>`+
     `<p>Fix them in that order. Nine times out of ten it is the first two.</p>`},
   craft:{h:`How to work on it`,b:`<p>I do not have a set exercise for that specific thing, so let me give you the method rather than pretend otherwise.</p>`+
     `<ol><li><b>Name the behaviour</b> you actually want to see, in one sentence</li><li><b>Find the objective</b> that would produce it naturally — what would make a real person do that?</li><li><b>Build one exercise</b> that isolates it, thirty seconds long, filmed</li><li><b>Watch on mute</b> and judge only that one thing</li><li><b>Repeat with one variable changed</b></li></ol>`},
   vocab:{h:`Working it out`,b:`<p>I would rather not guess at a definition. Tell me where you saw the term — a breakdown, a call sheet, a contract, a class — and I can usually work out what is meant from the context.</p>`}
  };
  const f=frames[shape]||frames.craft;
  return `<p>Let's work on it properly, even though it is not one of my set lessons.</p><div class="hd">${f.h}</div>${f.b}`+
   `<p style="opacity:.75">Tell me what happens when you try it and I will adjust from there.</p>`;
}

/* ── UI ──────────────────────────────────────────────────────── */


const st={plan:'visitor',level:'beginner',open:false,misses:0,lastOut:null,lesson:null,step:0,offer:null,profile:{weak:[],declared:null,taught:[]},lastConcept:null};
const ctx=()=>{const c=(window.__CS_CASTORIA_CTX||{});return{plan:c.plan||'visitor',name:c.name||''};};
const CHECKS=['Is that what you were looking for?','Did that answer your question?','Was that helpful?','Does that cover it?'];
let checkIdx=0;

function stamp(){
  const d=new Date(), h=d.getHours(), m=String(d.getMinutes()).padStart(2,'0');
  const t=`${((h+11)%12)+1}:${m} ${h<12?'AM':'PM'}`;
  const el=document.createElement('div');el.className='stamp';el.innerHTML=`<b>Today</b> ${t}`;
  $('thread').appendChild(el);
}
function bottom(){const t=$('thread');t.scrollTop=t.scrollHeight;}

function msg(dir,html){
  const th=$('thread');
  const prev=[...th.querySelectorAll('.msg')].pop();
  if(prev&&prev.classList.contains(dir)) prev.querySelector('.b').classList.remove('tail');
  const row=document.createElement('div');
  row.className='msg '+dir+((prev&&!prev.classList.contains(dir))?' gap':'');
  const b=document.createElement('div');b.className='b tail';b.innerHTML=html;
  row.appendChild(b);th.appendChild(row);bottom();return row;
}
function outMsg(text){
  const row=msg('out',text);
  if(st.lastOut){st.lastOut.remove();}
  const r=document.createElement('div');r.className='receipt';r.innerHTML='<b>Delivered</b>';
  row.after(r);st.lastOut=r;bottom();
}
const markRead=()=>{if(st.lastOut)st.lastOut.innerHTML='<b>Read</b>';};
function typing(){
  const row=document.createElement('div');row.className='msg in gap';
  row.innerHTML='<div class="typing"><i></i><i></i><i></i></div>';
  $('thread').appendChild(row);bottom();return row;
}
function card(o){
  const el=document.createElement('div');el.className='card';
  el.innerHTML=`<div class="top"><div class="eyebrow">${o.e||'Premium'}</div><div class="h">${o.h}</div><div class="b2">${o.b}</div></div>`+
   `<div class="go" data-go="1"><span>${o.cta||'See what Premium includes'}</span><i>&rsaquo;</i></div>`+
   `<div class="fine">${PRICEFINE}</div>`;
  $('thread').appendChild(el);bottom();
}
function srcs(ids){
  if(!ids||!ids.length)return;
  const w=document.createElement('div');w.className='srcs';
  ids.forEach(id=>{const b=document.createElement('button');b.textContent=ART[id].t;b.onclick=()=>sheet(id);w.appendChild(b);});
  $('thread').appendChild(w);bottom();
}
function sugg(list){
  const w=$('sugg');w.innerHTML='';
  (list||[]).forEach(l=>{const b=document.createElement('button');b.textContent=l;b.onclick=()=>{w.innerHTML='';send(l);};w.appendChild(b);});
  requestAnimationFrame(bottom);setTimeout(bottom,60);
}

function openPanel(){
  st.plan=ctx().plan;
  st.open=true;$('panel').classList.add('open');$('launch').classList.add('open');
  if(!$('thread').children.length)hello();
  setTimeout(()=>$('input').focus(),150);
}
function hello(){
  const c=ctx();stamp();
  const t=typing();
  setTimeout(()=>{
    t.remove();
    msg('in',c.name?`Hi ${c.name} \u{1F44B}`:`Hi there \u{1F44B}`);
    msg('in',`I'm Castoria, your virtual assistant.`);
    setTimeout(()=>{
      if(c.plan==='visitor'){
        msg('in',`I can answer questions about acting and about CastSlate — and I can teach. Would you like a quick <b>free acting lesson</b>? Two minutes, and you can do it right where you are sitting.`);
        st.offer='film';
        sugg(['Yes, teach me','What is CastSlate?','No thanks']);
        return;
      }
      msg('in',c.plan==='premium'
        ?`Everything's unlocked on your account — the Business Card and promo materials, the agency directory, Manager Mode, your Slate Video. Ask me how to use any of it, or anything about the acting side. I also run short lessons if you want to work on something.`
        :`Ask me anything about CastSlate or about the acting business — and if you want to actually <b>practise</b> something, I run short lessons you can do right now.`);
      sugg(['Give me an acting lesson','How do I improve my profile?',c.plan==='premium'?'What is Manager Mode?':'Is Premium worth it?']);
    },620);
  },700);
}

/* ── lesson engine ─────────────────────────────────────────────── */
const YES=/^(yes|yeah|yep|yup|sure|ok|okay|go on|please|go ahead|do it|teach me|sounds good|why not|alright|let's go|lets go|i'm in|im in)[\s!.,]*$/i;
const DEEPER=/^(go deeper|deeper|more detail|tell me more|full lesson|teach me (that|it|about that)|yes teach me .+)$/i;
const NO=/^(no|nah|not now|later|no thanks|maybe later|i'm good|im good)[\s!.,]*$/i;
const QUIT=/\b(stop|quit|exit|cancel|end) (the )?(lesson|exercise|class)\b|^(stop|quit|exit|nevermind|never mind)[\s!.,]*$/i;

function lessonStep(){
  const L=LESSON_BY_ID[st.lesson]; if(!L) return endLesson();
  const step=L.steps[st.step];
  if(!step) return endLesson();
  let html=step.b;
  if(st.level==='pro'&&step.pro) html+=step.pro;
  msg('in',html);
  if(step.end){
    st.lesson=null;st.step=0;
    setTimeout(()=>{
      const gap=st.profile.weak.find(w=>!st.profile.taught.includes('dyn-'+w)&&w!==st.lastConcept);
      if(gap&&CONCEPT_BY_ID[gap]){
        const g=CONCEPT_BY_ID[gap];
        msg('in',`That is yours to keep${st.plan==='visitor'?', account or not':''}.`);
        setTimeout(()=>{
          msg('in',`You mentioned earlier that <b>${g.name.toLowerCase()}</b> is something you struggle with. Want to work on that next? It is about ${g.what}.`);
          sugg([`Yes, teach me ${g.name.toLowerCase()}`,'Something else',st.plan==='visitor'?'What is CastSlate?':'How do I improve my profile?']);
        },620);
        return;
      }
      msg('in',st.plan==='visitor'
        ?`That is yours to keep, account or not. Want another one, or shall I tell you what CastSlate does?`
        :`Want another lesson, or shall we work on something specific in your profile?`);
      sugg(['Another lesson','Something else',st.plan==='visitor'?'What is CastSlate?':'How do I improve my profile?']);
    },700);
    return;
  }
  st.step++;
  sugg([step.cta||'Next','Stop the lesson']);
}
function startLesson(id){
  const L=(typeof id==='object')?id:LESSON_BY_ID[id];
  if(!L) return false;
  if(typeof id==='object'){LESSON_BY_ID['__dyn']=L;st.lesson='__dyn';} else st.lesson=id;
  st.step=0;st.offer=null;
  if(L.concept)st.lastConcept=L.concept;
  if(L.id&&!st.profile.taught.includes(L.id))st.profile.taught.push(L.id);
  msg('in',`<b>${L.title}</b><br><span style="opacity:.62">${L.lane} &middot; about ${L.mins} minutes &middot; you can stop any time</span>`);
  setTimeout(lessonStep,620);
  return true;
}
function dynamicLesson(c,depth,shape){
  const mins=depth==='quick'?1:depth==='standard'?3:depth==='masterclass'?8:5;
  return {id:'dyn-'+c.id,concept:c.id,title:c.name,lane:c.cat,mins,steps:compose(c,depth,st.level,shape)};
}
function endLesson(quiet){
  st.lesson=null;st.step=0;
  if(!quiet){msg('in',`No problem — we can pick that up whenever. What else is on your mind?`);sugg(['Give me a different lesson','How do I improve my profile?']);}
}

function send(text){
  st.plan=ctx().plan;
  const c=ctx();
  sugg([]);
  outMsg(text.replace(/[<>]/g,''));
  readTells(text);

  /* an offered lesson is waiting on a yes/no */
  if(st.offer){
    const id=st.offer;st.offer=null;
    if(NO.test(text.trim())){
      const t0=typing();
      setTimeout(()=>{t0.remove();markRead();msg('in',`All good. I am here if you change your mind — what would you like to know instead?`);sugg(['What is CastSlate?','How do I get an agent?','What can I ask you?']);},520);
      return;
    }
    if(YES.test(text.trim())){
      const t0=typing();
      setTimeout(()=>{t0.remove();markRead();startLesson(id);},560);
      return;
    }
    /* anything else: drop the offer and answer what they actually asked */
  }

  /* "go deeper" on the last thing discussed */
  if(!st.lesson&&DEEPER.test(text.trim())&&st.lastConcept&&CONCEPT_BY_ID[st.lastConcept]){
    const t0=typing();
    setTimeout(()=>{t0.remove();markRead();startLesson(dynamicLesson(CONCEPT_BY_ID[st.lastConcept],'deep','craft'));},560);
    return;
  }

  /* mid-lesson: coach through a problem, advance, or bail out */
  if(st.lesson){
    if(QUIT.test(text.trim())){
      const t0=typing();
      setTimeout(()=>{t0.remove();markRead();endLesson();},480);
      return;
    }
    if(STUCK.test(text)){
      const t0=typing();
      setTimeout(()=>{
        t0.remove();markRead();
        msg('in',coachThrough(CONCEPT_BY_ID[st.lastConcept]));
        sugg(['Tried it again','Give me a different angle','Stop the lesson']);
      },640);
      return;
    }
    if(/different angle|another way|something else instead/i.test(text)){
      const t0=typing();
      setTimeout(()=>{
        t0.remove();markRead();
        msg('in',`<p>Fair. Different route to the same place:</p>`+
          `<p><b>Stop working on the feeling entirely.</b> Give your character a small physical task in the scene — something with a real outcome. Play the task properly and let the scene happen around it.</p>`+
          `<p>Actors who cannot get there psychologically very often get there physically, and the other way round. Neither is the correct method.</p>`);
        sugg(['That helped','Carry on with the lesson','Stop the lesson']);
      },660);
      return;
    }
    const t0=typing();
    setTimeout(()=>{t0.remove();markRead();lessonStep();},560+Math.random()*320);
    return;
  }

  const t=typing();
  const r=think(text,c);
  const wait=650+Math.random()*450;

  setTimeout(()=>{
    t.remove();markRead();

    if(r.lesson){
      st.misses=0;
      st.lastConcept=null;
      startLesson(r.lesson);
      return;
    }
    if(r.teach){
      st.misses=0;
      const {c:cc,depth,shape}=r.teach;
      st.lastConcept=cc.id;
      if(depth==='quick'){
        msg('in',compose(cc,'quick',st.level,shape)[0].b);
        sugg(['Go deeper','Give me a different lesson','Something else']);
        return;
      }
      startLesson(dynamicLesson(cc,depth,shape));
      return;
    }
    if(r.gloss){
      st.misses=0;
      const {term,g}=r.gloss;
      msg('in',`<p><b>${term.charAt(0).toUpperCase()+term.slice(1)}</b> — ${g.d}.</p>`+(g.note?`<p>${g.note}</p>`:''));
      const follow=g.teach?[`Teach me about that`,'Something else']:['Another term','Something else'];
      setTimeout(()=>{
        if(g.teach)st.lastConcept=g.teach;
        sugg(follow);
      },200);
      return;
    }
    if(r.principles){
      st.misses=0;
      msg('in',principlesLesson(r.principles.shape,r.principles.q));
      sugg(['I tried it','Give me a related lesson','Something else']);
      return;
    }
    if(r.small){
      st.misses=0;
      msg('in',r.small.a(c));
      setTimeout(()=>{msg('in',r.small.b(c));sugg(r.small.s);},640);
      return;
    }
    if(r.decline){
      st.misses=0;
      msg('in',r.decline.a(c));
      srcs(r.decline.src);
      setTimeout(()=>{msg('in',r.decline.b(c));sugg(r.decline.s);},680);
      return;
    }
    if(r.miss){
      st.misses++;
      if(st.misses>=2){
        msg('in',`I've missed that twice, and guessing a third time won't help you.`);
        setTimeout(()=>{msg('in',`I'm passing this thread to the CastSlate team with the whole conversation attached — someone will pick it up from here.`);sugg([]);},640);
        st.misses=0;return;
      }
      const near=nearestTopics(text);
      if(near.length){
        msg('in',`I'm not certain which you mean — did you want one of these?`);
        setTimeout(()=>{sugg(near.concat(['Something else']));},420);
        return;
      }
      msg('in',`I'm not sure I follow — try different words and I'll have another go.`);
      setTimeout(()=>{msg('in',`Or pick one of these if it's close.`);sugg(OFFTOPICFALLBACK);},600);
      return;
    }

    const e=r.entry;st.misses=0;
    msg('in',e.a(c));
    if(e.sell&&c.plan!=='premium')setTimeout(()=>card(e.sell(c)),240);
    setTimeout(()=>srcs(e.src),e.sell&&c.plan!=='premium'?300:60);
    if(!e.nocheck){
      setTimeout(()=>{msg('in',CHECKS[checkIdx++%CHECKS.length]);sugg(e.s);},900);
    } else sugg(e.s);
  },wait);
}

function sheet(id){
  const a=ART[id];
  $('sheetbody').innerHTML=`<h2>${a.t}</h2><div class="meta">CastSlate help</div>${a.c}`;
  $('sheet').classList.add('on');$('sheetbody').scrollTop=0;
}


$('launch').onclick=function(){ if(st.open){st.open=false;$('panel').classList.remove('open');$('launch').classList.remove('open');} else openPanel(); };
$('sheetback').onclick=function(){$('sheet').classList.remove('on');};
$('back').onclick=function(){st.open=false;$('panel').classList.remove('open');$('launch').classList.remove('open');};
var inp=$('input');
inp.oninput=function(){inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,86)+'px';$('send').disabled=!inp.value.trim();};
inp.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('send').click();}};
$('send').onclick=function(){var v=inp.value.trim();if(!v)return;inp.value='';inp.style.height='auto';$('send').disabled=true;send(v);};
ROOT.addEventListener('click',function(e){
  var t=(e.composedPath&&e.composedPath()[0])||e.target;
  if(t&&t.closest){
    var nv=t.closest('[data-nav]');
    if(nv){ if(window.__CS_NAV){window.__CS_NAV(nv.getAttribute('data-nav'));st.open=false;$('panel').classList.remove('open');$('launch').classList.remove('open');} else {send('How do I cancel my subscription?');} return; }
    var a=t.closest('[data-ask]'); if(a){send(a.getAttribute('data-ask'));return;}
  }
  if(t&&t.closest&&t.closest('[data-go]')){
    if(window.__CS_NAV){window.__CS_NAV('membership');st.open=false;$('panel').classList.remove('open');$('launch').classList.remove('open');}
    else send('How do I upgrade to Premium?');
  }
});
window.Castoria={open:openPanel,ask:function(q){openPanel();setTimeout(function(){send(q);},700);}};
if(window.__CS_CASTORIA_OPEN_NOW)setTimeout(openPanel,400);

})();
