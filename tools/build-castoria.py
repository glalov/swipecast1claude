#!/usr/bin/env python3
"""Generate /castoria.js from the Castoria prototype.

The prototype (castslate-castoria-agent-demo.html) is the source of truth for
the assistant's knowledge, lessons and copy — it is where you edit. This script
strips the demo harness (persona switcher, level toggle, spec panel), rewrites
the widget to mount itself inside a shadow root, and writes the production file.

    python3 tools/build-castoria.py && python3 build-html.py
"""
import io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, "castslate-castoria-agent-demo.html")
OUT  = os.path.join(ROOT, "castoria.js")

MARKUP = """<div class="nudge" id="nudge" aria-hidden="true"><b>Try Super Assistant</b></div>
<button class="launch" id="launch" aria-label="Message Super Assistant">
  <svg class="clap" viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="12.6" width="24" height="14.4" rx="2.6" fill="var(--board)"/><rect x="7" y="16" width="18" height="2" rx="1" fill="var(--cm1)"/><rect x="7" y="20" width="12" height="2" rx="1" fill="var(--cm2)"/><g class="stick"><rect x="3.5" y="5" width="25" height="6.6" rx="1.4" fill="var(--board)"/><g clip-path="url(#csClip)" fill="var(--stripe)"><polygon points="5,11.6 8.6,5 12,5 8.4,11.6"/><polygon points="13,11.6 16.6,5 20,5 16.4,11.6"/><polygon points="21,11.6 24.6,5 28,5 24.4,11.6"/></g></g><defs><clipPath id="csClip"><rect x="3.5" y="5" width="25" height="6.6" rx="1.4"/></clipPath></defs></svg>
  <span class="x">&times;</span>
</button>
<div class="panel" id="panel" role="dialog" aria-label="Super Assistant">
  <div class="bar" id="bar">
    <button class="xreset" id="newchat" aria-label="Start a new chat" title="New chat"><svg viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.8 3.6v4.6h-4.6"/></svg></button>
    <button class="xexpand" id="expand" aria-label="Make the panel smaller" title="Smaller"><svg viewBox="0 0 24 24"><g class="i-grow"><path d="M15 4h5v5M9 20H4v-5M20 4l-7 7M4 20l7-7"/></g><g class="i-shrink"><path d="M20 9h-5V4M4 15h5v5M15 9l5-5M9 15l-5 5"/></g></svg></button>
    <button class="xclose" id="close" aria-label="Close Super Assistant">&#10005;</button>
    <div class="ava"><svg class="clap" viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="12.6" width="24" height="14.4" rx="2.6" fill="var(--board)"/><rect x="7" y="16" width="18" height="2" rx="1" fill="var(--cm1)"/><rect x="7" y="20" width="12" height="2" rx="1" fill="var(--cm2)"/><g class="stick"><rect x="3.5" y="5" width="25" height="6.6" rx="1.4" fill="var(--board)"/><g clip-path="url(#csClip)" fill="var(--stripe)"><polygon points="5,11.6 8.6,5 12,5 8.4,11.6"/><polygon points="13,11.6 16.6,5 20,5 16.4,11.6"/><polygon points="21,11.6 24.6,5 28,5 24.4,11.6"/></g></g><defs><clipPath id="csClip"><rect x="3.5" y="5" width="25" height="6.6" rx="1.4"/></clipPath></defs></svg></div>
    <b>Super Assistant</b>
    <i id="barsub">Acting coach</i>
  </div>
  <div class="thread" id="thread"></div>
  <div class="suggwrap" id="suggwrap">
    <div class="sugg" id="sugg"></div>
    <div class="suggbar" id="suggbar">
      <button class="suggmore" id="suggmore" type="button" tabindex="-1">More questions <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
      <button class="suggfold" id="suggfold" type="button" aria-expanded="true" aria-controls="sugg" aria-label="Hide suggested questions"><span class="lbl" id="suggfoldlbl">Hide</span><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>
    </div>
  </div>
  <div class="composer">
    <div class="emoji" id="emoji"></div>
    <div class="cbox">
      <textarea id="input" rows="1" placeholder="Message"></textarea>
      <div class="ctools">
        <button class="tool" id="tTopics" aria-label="What I can help with" title="What I can help with"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg></button>
        <button class="tool" id="tEmoji" aria-label="Emoji" title="Emoji"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.6 14.2c.9 1.1 2.1 1.7 3.4 1.7s2.5-.6 3.4-1.7"/><path d="M9.2 9.4h.01M14.8 9.4h.01"/></svg></button>
        <button class="tool" id="tLesson" aria-label="Acting lessons" title="Acting lessons"><svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7.6 4.5v15M16.4 4.5v15M3 9.4h4.6M3 14.6h4.6M16.4 9.4H21M16.4 14.6H21"/></svg></button>
        <button class="tool" id="tMic" aria-label="Dictate" title="Speak instead of typing"><svg viewBox="0 0 24 24"><rect x="9" y="2.8" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3.2"/></svg></button>
        <span class="sp"></span>
        <button class="snd" id="send" disabled aria-label="Send"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:#fff;stroke:none"><path d="M12 3l7 7h-4.5v11h-5V10H5z"/></svg></button>
      </div>
    </div>
    <div class="foot">Super Assistant is an automated assistant. A person can take over any time.</div>
  </div>
  <div class="sheet" id="sheet">
    <div class="bar sub"><button class="back" id="sheetback">&lsaquo; Back</button><b>Help</b><i>CastSlate</i></div>
    <div class="sheetbody" id="sheetbody"></div>
  </div>
</div>"""

TAIL = r"""
$('launch').onclick=function(){ if(st.open)closePanel(); else openPanel(); };
$('sheetback').onclick=function(){$('sheet').classList.remove('on');};
$('close').onclick=function(){closePanel();};
wireTools();
var inp=$('input');
inp.oninput=function(){inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,86)+'px';$('send').disabled=!inp.value.trim();};
inp.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('send').click();}};
$('send').onclick=function(){var v=inp.value.trim();if(!v)return;inp.value='';inp.style.height='auto';$('send').disabled=true;send(v);};
ROOT.addEventListener('click',function(e){
  var t=(e.composedPath&&e.composedPath()[0])||e.target;
  if(t&&t.closest){
    var nv=t.closest('[data-nav]');
    if(nv){ if(window.__CS_NAV){window.__CS_NAV(nv.getAttribute('data-nav'));closePanel();} else {send('Where are my account settings?');} return; }
    var a=t.closest('[data-ask]'); if(a){send(a.getAttribute('data-ask'));return;}
  }
  if(t&&t.closest&&t.closest('[data-go]')){
    if(window.__CS_NAV){window.__CS_NAV('membership');closePanel();}
    else send('How do I upgrade to Premium?');
  }
});
var api={open:openPanel,ask:function(q){openPanel();setTimeout(function(){send(q);},700);}};
window.SuperAssistant=api;
/* Kept so anything that already calls window.Castoria keeps working. */
window.Castoria=api;
if(window.__CS_CASTORIA_OPEN_NOW)setTimeout(openPanel,400);

/* ── The launcher drops in a second and a half AFTER the intro curtain has
   finished falling, so it reads as its own beat rather than one more thing
   moving while the page is still revealing itself. The wait is measured from
   the real cs:intro-done signal that build-html.py emits, not a fixed timer,
   so on a slow connection — where the curtain holds until the app has
   painted — it still lands the same interval after the reveal instead of
   drifting into it. Mirrors armLaunchDrop() in the prototype. */
(function(){
  var WAIT=1500, el=$('launch'), fired=false;
  function fire(){ if(fired||!el)return; fired=true; el.classList.add('drop'); }
  function schedule(){
    var at=window.__CS_INTRO_DONE_AT||Date.now();
    setTimeout(fire, Math.max(0, WAIT-(Date.now()-at)));
  }
  if(window.__CS_INTRO_DONE){ schedule(); return; }
  /* No intro on this page: nothing to wait for, so show it straight away. */
  if(!document.getElementById('cs-intro')){ fire(); return; }
  window.addEventListener('cs:intro-done', schedule, {once:true});
  /* A stuck or missing signal must never strand the only affordance the
     assistant has. */
  setTimeout(fire, 8000);
})();
"""

def main():
    src = io.open(SRC, encoding="utf-8").read()
    css = src.split("<style>")[1].split("</style>")[0]
    js  = src.split("<script>")[1].split("</" + "script>")[0]

    # keep only the widget styles, and scope them to the shadow host
    css = css[: css.index("/* ── demo stage")] + css[css.index("/* ── launcher") :]
    css = css.replace(":root{", ":host{", 1)
    css = css.replace(
        "body{font-family:var(--sys);background:var(--page);color:var(--ink);min-height:100vh;}", ""
    )

    core = js[: js.index("/* events */")]
    core = core.replace("const $=id=>document.getElementById(id);", "")
    core = core.replace("const NAMES={visitor:'',free:'Lena',premium:'Marcus'};", "")
    core = core.replace(
        "const ctx=()=>({plan:st.plan,name:NAMES[st.plan]});",
        "const ctx=()=>{const c=(window.__CS_CASTORIA_CTX||{});"
        "return{plan:c.plan||'visitor',name:c.name||''};};",
    )
    core = core.replace("const st={plan:'free',level:'beginner',", "const st={plan:'visitor',level:'beginner',")
    # st.plan used to be refreshed here; syncIdentity() owns it now — it also
    # wipes the thread when the signed-in person changes, which this could not.

    for marker in ("NAMES[", "$('persona", "#persona", "#level", "#tries", "sysprompt", "kbstat"):
        if marker in core:
            sys.exit("build-castoria: demo-only reference survived the strip: " + marker)

    out = (
        "/* Castoria — CastSlate virtual assistant.\n"
        "   Self-contained, no dependencies, rendered in a shadow root so nothing here\n"
        "   can collide with site CSS and site CSS cannot reach in.\n"
        "   GENERATED from castslate-castoria-agent-demo.html by tools/build-castoria.py.\n"
        "   Do not hand-edit — edit the prototype and regenerate. */\n"
        "(function(){\n"
        "if(window.__CASTORIA_READY)return; window.__CASTORIA_READY=1;\n"
        "var host=document.createElement('div');\n"
        "host.id='castoria-root';\n"
        "host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483000;';\n"
        "document.body.appendChild(host);\n"
        "var ROOT=host.attachShadow({mode:'open'});\n"
        "var sEl=document.createElement('style');\n"
        "sEl.textContent=" + json.dumps(css) + ";\n"
        "ROOT.appendChild(sEl);\n"
        "var wrap=document.createElement('div');\n"
        "wrap.style.cssText='pointer-events:auto;';\n"
        "wrap.innerHTML=" + json.dumps(MARKUP) + ";\n"
        "ROOT.appendChild(wrap);\n"
        "var $=function(id){return ROOT.getElementById(id);};\n"
        + core + TAIL +
        "\n})();\n"
    )
    io.open(OUT, "w", encoding="utf-8").write(out)
    print("  ✓ castoria.js written ({:,} chars)".format(len(out)))

if __name__ == "__main__":
    main()
