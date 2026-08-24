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

MARKUP = """<button class="launch" id="launch" aria-label="Message Castoria">
  <svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 5.9 2 10.7c0 2.7 1.4 5.1 3.7 6.7-.2 1.5-.9 2.9-1.9 3.9 1.7-.2 3.4-.9 4.8-1.9 1.1.3 2.2.5 3.4.5 5.5 0 10-3.9 10-8.7S17.5 2 12 2z"/></svg>
  <span class="x">&times;</span>
</button>
<div class="panel" id="panel" role="dialog" aria-label="Castoria virtual assistant">
  <div class="bar" id="bar">
    <button class="back" id="back">&lsaquo; Close</button>
    <div class="ava">C</div>
    <b>Castoria</b>
    <i id="barsub">Virtual assistant</i>
  </div>
  <div class="thread" id="thread"></div>
  <div class="sugg" id="sugg"></div>
  <div class="composer">
    <div class="field">
      <div class="box"><textarea id="input" rows="1" placeholder="Message"></textarea></div>
      <button class="snd" id="send" disabled aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 3l7 7h-4.5v11h-5V10H5z"/></svg></button>
    </div>
    <div class="foot">Castoria is an automated assistant. A person can take over any time.</div>
  </div>
  <div class="sheet" id="sheet">
    <div class="bar sub"><button class="back" id="sheetback">&lsaquo; Back</button><b>Help</b><i>CastSlate</i></div>
    <div class="sheetbody" id="sheetbody"></div>
  </div>
</div>"""

TAIL = r"""
$('launch').onclick=function(){ if(st.open){st.open=false;$('panel').classList.remove('open');$('launch').classList.remove('open');} else openPanel(); };
$('sheetback').onclick=function(){$('sheet').classList.remove('on');};
$('back').onclick=function(){st.open=false;$('panel').classList.remove('open');$('launch').classList.remove('open');};
var inp=$('input');
inp.oninput=function(){inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,86)+'px';$('send').disabled=!inp.value.trim();};
inp.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('send').click();}};
$('send').onclick=function(){var v=inp.value.trim();if(!v)return;inp.value='';inp.style.height='auto';$('send').disabled=true;send(v);};
ROOT.addEventListener('click',function(e){
  var t=(e.composedPath&&e.composedPath()[0])||e.target;
  if(t&&t.closest){var a=t.closest('[data-ask]'); if(a){send(a.getAttribute('data-ask'));return;}}
  if(t&&t.closest&&t.closest('[data-go]')){
    if(window.__CS_NAV){window.__CS_NAV('membership');st.open=false;$('panel').classList.remove('open');$('launch').classList.remove('open');}
    else send('How do I upgrade to Premium?');
  }
});
window.Castoria={open:openPanel,ask:function(q){openPanel();setTimeout(function(){send(q);},700);}};
if(window.__CS_CASTORIA_OPEN_NOW)setTimeout(openPanel,400);
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
    core = core.replace("function send(text){\n  const c=ctx();", "function send(text){\n  st.plan=ctx().plan;\n  const c=ctx();")
    core = core.replace("function openPanel(){\n  st.open=true;", "function openPanel(){\n  st.plan=ctx().plan;\n  st.open=true;")

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
