#!/usr/bin/env node
/* Super Assistant regression suite.

     node tools/sa-tests/super-assistant.test.mjs            # the prototype (source of truth)
     SA_URL=https://castslate.com node tools/sa-tests/...     # the live widget

   Drives the real widget in headless Chrome (Playwright, channel "chrome") and
   asserts, for every lesson in SYLLABUS, that a TAP opens exactly that lesson:
   the id echoed in state and in the trace, the lesson's key terms present,
   no other lesson's lead term in the opening. Each lesson runs 3 times.
   Plus: the index/paraphrase regression guard, the 10-turn no-repeat
   conversation, chip validity per state, and phone-width tap checks.

   Playwright is resolved from PLAYWRIGHT_PATH or the usual node_modules. */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pw;
for (const c of [process.env.PLAYWRIGHT_PATH, 'playwright', '/Users/georgi/Desktop/latest package 1/node_modules/playwright']) {
  if (!c) continue;
  try { pw = require(c); break; } catch (_) {}
}
if (!pw) { console.error('playwright not found — set PLAYWRIGHT_PATH'); process.exit(2); }
const { chromium, devices } = pw;

const LIVE = process.env.SA_URL || '';
const DEMO = 'file://' + path.resolve(here, '../../castslate-castoria-agent-demo.html');
const RUNS = +(process.env.SA_RUNS || 3);

let pass = 0, fail = 0; const failures = [];
const ok = (cond, name, detail) => { if (cond) pass++; else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); } };

/* Everything runs inside the widget's own scope. On the live site that scope
   is the castoria.js closure, which exposes nothing — so on live we drive the
   shadow DOM only; on the prototype we can also read st/TRACE directly. */
async function boot(page) {
  await page.addInitScript(() => {
    const o = window.setTimeout; window.setTimeout = (f, d, ...a) => o(f, Math.min(d || 0, 2000) / 10, ...a);
  });
  await page.goto(LIVE || DEMO, { waitUntil: 'domcontentloaded' });
  if (LIVE) {
    await page.waitForFunction(() => window.SuperAssistant && document.getElementById('castoria-root'), null, { timeout: 45000 });
    await page.evaluate(() => window.SuperAssistant.open());
  } else {
    await page.waitForFunction(() => typeof SYLLABUS !== 'undefined');
    await page.evaluate(() => { st.plan = 'free'; });
  }
}
/* A root that works for both: the shadow root on live, document on the demo. */
const R = `(document.getElementById('castoria-root')&&document.getElementById('castoria-root').shadowRoot)||document`;
async function fresh(page) {
  await page.evaluate(`(()=>{const r=${R}; if(window.SuperAssistant&&!(r.getElementById('panel')||{}).classList?.contains('open'))window.SuperAssistant.open(); r.getElementById('newchat').click();})()`);
  await settle(page);
}
async function settle(page) {
  /* quiet = no typing dots for 3 consecutive polls */
  let q = 0;
  for (let i = 0; i < 80 && q < 3; i++) {
    await page.waitForTimeout(90);
    const busy = await page.evaluate(`!!(${R}).querySelector('#thread .typing')`);
    q = busy ? 0 : q + 1;
  }
  await page.waitForTimeout(120);
}
const typeSend = (page, text) => page.evaluate(`(()=>{const r=${R};const i=r.getElementById('input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input'));r.getElementById('send').click();})()`).then(() => settle(page));
const inMsgs = page => page.evaluate(`[...(${R}).querySelectorAll('#thread .msg.in .b')].map(b=>({t:b.innerText.replace(/\\s+/g,' ').trim(),h:b.innerHTML}))`);
const chips = page => page.evaluate(`[...(${R}).querySelectorAll('#sugg button')].map(b=>({t:b.textContent,lesson:b.getAttribute('data-lesson'),act:b.getAttribute('data-act')}))`);
const syllabus = async page => LIVE ? null : page.evaluate(() => SYLLABUS.map(x => ({ id: x.id, group: x.group, title: x.title, keys: x.keys, lead: x.lead })));
const state = page => LIVE ? null : page.evaluate(() => ({ lesson: st.lesson, step: st.step, paused: st.paused && st.paused.id, lastTap: (TRACE.filter(x => x.kind === 'lesson-tap').pop() || {}) }));

async function tapLessonTest(page, SYL) {
  for (const which of ['fundamentals', 'all']) {
    const group = SYL.filter(x => which === 'all' || x.group === 'fundamentals');
    for (const S of group) for (let run = 1; run <= RUNS; run++) {
      await fresh(page);
      await typeSend(page, which === 'fundamentals' ? 'Teach me the fundamentals' : 'Give me an acting lesson');
      const before = (await inMsgs(page)).length;
      const hit = await page.evaluate(`(()=>{const b=[...(${R}).querySelectorAll('#thread button.inl[data-lesson]')].reverse().find(b=>b.getAttribute('data-lesson')===${JSON.stringify(S.id)});if(!b)return null;const t=b.getAttribute('data-title');b.click();return t;})()`);
      ok(hit === S.title, `[${which}] menu shows ${S.id} with exact title`, `got ${hit}`);
      await settle(page);
      const msgs = (await inMsgs(page)).slice(before);
      const reply = msgs.map(m => m.t).join(' ').toLowerCase();
      const st = await state(page);
      const label = `[${which}] tap ${S.title} run ${run}`;
      if (st) {
        ok(st.lesson === S.id, label + ': lesson id in state', `state.lesson=${st.lesson}`);
        ok(st.lastTap.lessonId === S.id && st.lastTap.title === S.title && st.lastTap.ok, label + ': tap carried id+title', JSON.stringify(st.lastTap));
      }
      ok(S.keys.some(k => reply.includes(k)), label + ': key terms present', `keys=${S.keys} reply=${reply.slice(0, 120)}`);
      const opening = reply.slice(0, 260);
      const foreign = SYL.filter(o => o.id !== S.id && o.group === S.group && opening.includes(o.lead) && !opening.includes(S.lead));
      ok(!foreign.length, label + ': no other lesson leads', foreign.map(f => f.id).join(','));
      if (S.group === 'fundamentals') {
        const other = SYL.filter(o => o.group === 'fundamentals' && o.id !== S.id && !S.keys.includes(o.lead) && reply.includes(o.lead));
        ok(!other.length, label + ': other fundamentals absent', other.map(o => o.id + ':' + o.lead).join(','));
      }
      const ch = await chips(page);
      ok(ch.some(c => c.act === 'stop') && ch.some(c => c.act === 'next'), label + ': in-lesson chips = next/…/stop', JSON.stringify(ch.map(c => c.t)));
    }
  }
  /* the chip strip under the fundamentals menu opens the same lessons */
  for (const S of SYL.filter(x => x.group === 'fundamentals')) {
    await fresh(page);
    await typeSend(page, 'Teach me the fundamentals');
    const ch = await chips(page);
    ok(ch.length === 8 && ch.every(c => c.lesson), 'menu chips are the 8 lessons with ids', JSON.stringify(ch));
    ok(!ch.some(c => c.act === 'stop'), 'no Stop chip on the menu');
    await page.evaluate(`[...(${R}).querySelectorAll('#sugg button')].find(b=>b.getAttribute('data-lesson')===${JSON.stringify(S.id)}).click()`);
    await settle(page);
    const st = await state(page);
    if (st) ok(st.lesson === S.id, `chip ${S.title} opens ${S.id}`, `got ${st.lesson}`);
  }
}

async function regressionGuards(page) {
  /* 1. No data-ask anywhere may open a lesson — lessons are id-only. */
  const leaks = await page.evaluate(() => {
    const src = document.documentElement.outerHTML + [...document.scripts].map(s => s.textContent).join('\n');
    const asks = [...src.matchAll(/data-ask="([^"]+)"/g)].map(m => m[1]);
    return [...new Set(asks)].filter(a => { const r = think(a, ctx()); return r && (r.lesson || r.menu); });
  });
  ok(!leaks.length, 'no data-ask button routes to a lesson (must be data-lesson)', leaks.join(' | '));
  /* 2. Every menu button's id + title comes from SYLLABUS. */
  const menuBad = await page.evaluate(() => {
    const d = document.createElement('div'); d.innerHTML = menuHTML('all') + menuHTML('fundamentals');
    return [...d.querySelectorAll('button')].filter(b => !b.dataset.lesson || !SYL_BY_ID[b.dataset.lesson] || SYL_BY_ID[b.dataset.lesson].title !== b.dataset.title || b.hasAttribute('data-ask')).map(b => b.outerHTML);
  });
  ok(!menuBad.length, 'menus are rendered from SYLLABUS only', menuBad.join(' '));
  /* 3. Order independence: shuffling the rendered list cannot change a tap. */
  const orderSafe = await page.evaluate(() => {
    const d = document.createElement('div'); d.innerHTML = menuHTML('fundamentals');
    const btns = [...d.querySelectorAll('button[data-lesson]')].reverse();
    return btns.every(b => SYL_BY_ID[b.dataset.lesson].title === b.textContent);
  });
  ok(orderSafe, 'label and id agree regardless of rendered order');
  /* 4. A string chip that names a lesson is given its id at render time. */
  const strChips = await page.evaluate(() => [...TOPIC_POOL, ...OPENING_FREE, ...OPENING_PREMIUM].map(x => ({ x, spec: chipSpec(x), r: think(x, ctx()) }))
    .filter(o => o.r && o.r.lesson && SYL_BY_ID[o.r.lesson] && !(o.spec && o.spec.lesson === o.r.lesson)).map(o => o.x));
  ok(!strChips.length, 'lesson-naming string chips carry their id', strChips.join(' | '));
  /* 5. Unknown / mismatched id asks instead of guessing. */
  for (const [id, title] of [['nope', 'Nope'], ['tactics', 'Objective'], ['', '']]) {
    await fresh(page);
    await page.evaluate(([i, t]) => pickLesson(i, t, t || '?'), [id, title]);
    await settle(page);
    const s = await state(page);
    const last = (await inMsgs(page)).map(m => m.t).join(' ');
    ok(s.lesson === null && /not sure which lesson/i.test(last), `bad tap (${id}/${title}) asks which`, `lesson=${s.lesson}`);
  }
  /* 6. Every lesson opening passes onTopic, and every stored step exists. */
  const bad = await page.evaluate(() => SYLLABUS.filter(S => !onTopic(S.id, LESSON_BY_ID[S.id].steps[0].b)).map(S => S.id));
  ok(!bad.length, 'every lesson opening passes onTopic', bad.join(','));
  /* 7. Typing a menu item's bare name opens it. */
  const typed = await page.evaluate(() => SYLLABUS.filter(S => (think(S.title, ctx()) || {}).lesson !== S.id).map(S => S.title + '->' + JSON.stringify(think(S.title, ctx()).lesson || '?')));
  ok(!typed.length, 'typed menu names open the same lesson', typed.join(' | '));
}

const PITCH_TEST = [
  ['notepad', /\bnote ?pad\b|\ba pen\b/i], ['noclasses', /spend money on (acting )?class|pay for (acting )?class/i],
  ['free', /\bfor free\b|\bfree, right here\b|\bat no cost\b|\bteach[^.]{0,60}\bfree\b/i], ['thread', /\bin this thread\b/i],
  ['lessonend', /every lesson ends with/i], ['workshops', /worth more than most beginner workshops/i]];
const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
async function conversationTest(page, plan) {
  await page.evaluate(p => { st.plan = p; st.identity = idKey(ctx()); }, plan);
  await fresh(page);
  const log = []; // {turn, state, chips}
  const snap = async turn => log.push({ turn, st: await state(page), chips: await chips(page) });
  await snap('intro');
  const turns = [
    ['type', 'What can you teach?'],
    ['type', 'Teach me the fundamentals'],
    ['lesson', 'tactics'],
    ['act', 'next'],
    ['act', 'faq'],
    ['type', 'What is a callback?'],
    ['act', 'resume'],
    ['act', 'next'],
    ['lesson', 'givencirc'],
    ['act', 'next'],
  ];
  for (const [k, v] of turns) {
    if (k === 'type') await typeSend(page, v);
    if (k === 'lesson') { const found = await page.evaluate(`(()=>{const b=[...(${R}).querySelectorAll('#sugg button[data-lesson],#thread button.inl[data-lesson]')].find(b=>b.getAttribute('data-lesson')===${JSON.stringify(v)}); if(b){b.click();return true;} return false;})()`); ok(found, `[${plan}] a button for ${v} is on screen`); await settle(page); }
    if (k === 'act') { const clicked = await page.evaluate(`(()=>{const b=[...(${R}).querySelectorAll('#sugg button[data-act="${v}"]')][0]; if(b){b.click();return true;} return false;})()`); ok(clicked, `[${plan}] chip act=${v} offered when needed`); await settle(page); }
    await snap(k + ':' + v);
  }
  const msgs = (await inMsgs(page)).map(m => m.t);
  /* one-time intro lines */
  for (const [fam, re] of PITCH_TEST) {
    const n = msgs.filter(m => re.test(m)).length;
    ok(n <= 1, `[${plan}] pitch "${fam}" at most once`, `appeared ${n}x: ` + msgs.filter(m => re.test(m)).map(m => m.slice(0, 80)).join(' || '));
  }
  /* no sentence shape repeats within any 5-message window */
  const sents = msgs.map(m => (m.match(/[^.!?]+[.!?]*/g) || []).map(s => norm(s)).filter(w => w.length >= 4).map(w => w.join(' ')));
  for (let i = 0; i < sents.length; i++) for (let j = Math.max(0, i - 5); j < i; j++) {
    const dup = sents[i].filter(s => sents[j].includes(s));
    ok(!dup.length, `[${plan}] no repeat within 5 msgs (msg ${j}→${i})`, dup.join(' | '));
  }
  /* chips by state */
  const menuChips = log.find(l => l.turn === 'type:Teach me the fundamentals').chips.map(c => c.t).join('|');
  const midChips = log.find(l => l.turn === 'act:next').chips.map(c => c.t).join('|');
  const endRow = log.find(l => l.st && l.st.lesson === null && l.chips.some(c => c.act === 'menu'));
  ok(!!endRow, `[${plan}] end-of-lesson chips include Back to the menu`);
  const endChips = endRow ? endRow.chips.map(c => c.t).join('|') : '';
  ok(menuChips !== midChips && midChips !== endChips && menuChips !== endChips, `[${plan}] chips differ menu/mid/end`, [menuChips, midChips, endChips].join('  ##  '));
  for (const l of log) {
    const stop = l.chips.some(c => /stop the lesson/i.test(c.t));
    ok(!stop || (l.st && (l.st.lesson || l.st.paused)), `[${plan}] no Stop chip without a lesson (${l.turn})`);
  }
  /* "Tap any of those" only with tappable items in the same message */
  const tapHint = await page.evaluate(`[...(${R}).querySelectorAll('#thread .msg.in .b')].filter(b=>/tap any of those/i.test(b.innerText)).every(b=>b.querySelector('button[data-lesson]'))`);
  ok(tapHint, `[${plan}] "Tap any of those" only beside real buttons`);
  /* a selected lesson starts with the lesson — no re-intro */
  const tIdx = msgs.findIndex(m => /^tactics: how you go after/i.test(m));
  ok(tIdx >= 0 && /^lesson: tactics/i.test(msgs[tIdx + 1] || ''), `[${plan}] tapped lesson opens straight on the lesson`, (msgs[tIdx + 1] || '').slice(0, 80));
  return msgs;
}

/* The no-repeat filter must never eat lesson content: play every lesson to
   the end in a fresh chat and check every stored sentence reached the screen. */
async function playthroughTest(page, SYL) {
  for (const S of SYL) {
    await fresh(page);
    await page.evaluate(([id, t]) => pickLesson(id, t, t), [S.id, S.title]);
    await settle(page);
    for (let i = 0; i < 12; i++) {
      const has = await page.evaluate(`!!(${R}).querySelector('#sugg button[data-act="next"]')`);
      if (!has) break;
      await page.evaluate(`(${R}).querySelector('#sugg button[data-act="next"]').click()`);
      await settle(page);
    }
    const shown = (await inMsgs(page)).map(m => m.t).join(' ').replace(/\s+/g, ' ');
    const missing = await page.evaluate(([id, shown]) => {
      const out = [];
      const sq = t => t.replace(/[\s\u00a0]+/g, '');
      const flat = sq(shown);
      LESSON_BY_ID[id].steps.forEach(stp => { const d = document.createElement('div'); d.innerHTML = stp.b;
        d.querySelectorAll('p,li,.hd,b,em').forEach(el => el.insertAdjacentText('afterend', ' '));
        splitSents(d.textContent).forEach(x => { if (x.length > 3 && !flat.includes(sq(x))) out.push(x); }); });
      return out;
    }, [S.id, shown]);
    ok(!missing.length, `lesson ${S.id} plays in full`, missing.slice(0, 3).join(' | '));
    const endCh = await chips(page);
    ok(endCh.some(c => c.act === 'menu') && !endCh.some(c => c.act === 'stop'), `lesson ${S.id} ends with next/menu chips`, JSON.stringify(endCh.map(c => c.t)));
  }
}

async function mobileTest(browser) {
  for (const dev of ['iPhone 13', 'Pixel 7']) {
    const ctxm = await browser.newContext({ ...devices[dev] });
    const page = await ctxm.newPage();
    await boot(page);
    await fresh(page);
    await typeSend(page, 'Teach me the fundamentals');
    const m = await page.evaluate(`(()=>{const r=${R};const out=[];
      const vw=innerWidth;
      r.querySelectorAll('#sugg button, #thread button.inl[data-lesson]').forEach(b=>{const x=b.getBoundingClientRect();out.push({t:b.textContent,h:Math.round(x.height),w:Math.round(x.width),l:x.left,rt:x.right,vw});});
      return out;})()`);
    const small = m.filter(x => x.h < 44);
    ok(!small.length, `[${dev}] tap targets >= 44px tall`, small.map(x => x.t + ':' + x.h).join(', '));
    const cut = m.filter(x => x.l < -1 || x.rt > x.vw + 1);
    ok(!cut.length, `[${dev}] no chip cut off horizontally`, cut.map(x => x.t).join(', '));
    /* real touch taps on each fundamentals menu item, scrolling it into view first */
    const SYL = await syllabus(page);
    for (const S of SYL.filter(x => x.group === 'fundamentals')) {
      await fresh(page);
      await typeSend(page, 'Teach me the fundamentals');
      const box = await page.evaluate(`(()=>{const r=${R};const b=[...r.querySelectorAll('#thread button.inl[data-lesson="${S.id}"]')].pop();b.scrollIntoView({block:'center'});const x=b.getBoundingClientRect();
        const cx=x.left+x.width/2, cy=x.top+x.height/2; const top=(r.elementFromPoint?r.elementFromPoint(cx,cy):document.elementFromPoint(cx,cy));
        return {cx,cy,covered:!(top===b||b.contains(top))};})()`);
      ok(!box.covered, `[${dev}] ${S.title} not covered by a fade/overlay`);
      await page.touchscreen.tap(box.cx, box.cy);
      await settle(page);
      const st = await state(page);
      ok(st.lesson === S.id, `[${dev}] touch-tap ${S.title} opens ${S.id}`, `got ${st.lesson}`);
    }
    await ctxm.close();
  }
}

/* The built widget (castoria.js) keeps its state in a closure, so live mode
   checks what a person sees: each tap's title card and opening, the chips. */
const LIVE_EXPECT = {
  objective: ['Objective:', 'objective'], stakes: ['Obstacle and stakes:', 'obstacle'], tactics: ['Tactics:', 'tactic'],
  givencirc: ['Given circumstances:', 'given circumstances'], listen: ['Listening:', 'listen'], subtext: ['Subtext:', 'subtext'],
  truth: ['Truthful behaviour:', 'stay normal'], scale: ['Scale:', 'scale'] };
const LEADS = { objective: 'objective', stakes: 'stakes', tactics: 'tactic', givencirc: 'given circumstances', listen: 'listening', subtext: 'subtext', truth: 'truthful behaviour', scale: 'scale' };
async function liveTest(browser) {
  for (const dev of [null, 'iPhone 13', 'Pixel 7']) {
    const c = await browser.newContext(dev ? { ...devices[dev] } : {});
    const page = await c.newPage();
    page.on('pageerror', e => { fail++; failures.push(`[${dev || 'desktop'}] page error: ` + e.message); });
    await boot(page);
    const tag = dev || 'desktop';
    for (const id of Object.keys(LIVE_EXPECT)) for (let run = 1; run <= (dev ? 1 : RUNS); run++) {
      await fresh(page);
      await typeSend(page, 'Teach me the fundamentals');
      const before = (await inMsgs(page)).length;
      const box = await page.evaluate(`(()=>{const r=${R};const b=[...r.querySelectorAll('#thread button.inl[data-lesson="${id}"]')].pop(); if(!b)return null; b.scrollIntoView({block:'center'}); const x=b.getBoundingClientRect(); return {cx:x.left+x.width/2,cy:x.top+x.height/2,h:x.height,title:b.getAttribute('data-title')};})()`);
      ok(!!box, `[${tag}] menu has ${id}`);
      if (!box) continue;
      if (dev) { ok(box.h >= 44, `[${tag}] ${id} tap target ${Math.round(box.h)}px >= 44`); await page.touchscreen.tap(box.cx, box.cy); }
      else await page.evaluate(`[...(${R}).querySelectorAll('#thread button.inl[data-lesson="${id}"]')].pop().click()`);
      await settle(page);
      const msgs = (await inMsgs(page)).slice(before).map(m => m.t);
      const [prefix, key] = LIVE_EXPECT[id];
      ok((msgs[0] || '').startsWith(prefix), `[${tag}] tap ${id} run ${run} opens its lesson`, (msgs[0] || '').slice(0, 70));
      const reply = msgs.join(' ').toLowerCase();
      ok(reply.includes(key), `[${tag}] ${id} key term present`);
      const other = Object.entries(LEADS).filter(([o, t]) => o !== id && reply.includes(t) && !LIVE_EXPECT[id][1].includes(t));
      ok(!other.length, `[${tag}] ${id} other fundamentals absent`, other.map(o => o[0]).join(','));
      const ch = await chips(page);
      ok(ch.some(x => x.act === 'next') && ch.some(x => x.act === 'stop'), `[${tag}] ${id} in-lesson chips`, ch.map(x => x.t).join('|'));
    }
    /* the menu itself offers lessons, never Stop */
    await fresh(page); await typeSend(page, 'Teach me the fundamentals');
    const mc = await chips(page);
    ok(mc.length === 8 && mc.every(x => x.lesson) && !mc.some(x => /stop/i.test(x.t)), `[${tag}] menu chips = 8 lessons, no Stop`, mc.map(x => x.t).join('|'));
    await c.close();
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => { fail++; failures.push('page error: ' + e.message); });
await boot(page);
if (LIVE) {
  await liveTest(browser);
} else {
  const SYL = await syllabus(page);
  await tapLessonTest(page, SYL);
  await regressionGuards(page);
  await playthroughTest(page, SYL);
  for (const plan of ['free', 'premium', 'visitor']) await conversationTest(page, plan);
  await mobileTest(browser);
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.slice(0, 80).map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
