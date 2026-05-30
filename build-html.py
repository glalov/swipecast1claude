import re, datetime

BUILD_VERSION = datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")

jsx_content = open("swipecast-full.jsx", "r").read()
# Strip the ES module `import` line — Babel standalone in the browser can't resolve imports
jsx_content = re.sub(r'^\s*import\s+.*?from\s+["\'][^"\']+["\'];?\s*\n', '', jsx_content, count=1, flags=re.MULTILINE)
# Replace `export default function App` with plain `function App`
jsx_content = jsx_content.replace("export default function App", "function App")
# swipecast-full.jsx already starts with the React hooks destructure — do NOT prepend again.
# Render the App at the end
jsx_content += "\nReactDOM.createRoot(document.getElementById('root')).render(<App />);\n"

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>CastSlate — Casting, finally built for actors.</title>
  <meta name="description" content="CastSlate is the casting platform where every submission gets seen. Free forever for actors. Trusted by CDs across film, TV, theater, and commercials."/>
  <meta property="og:title" content="CastSlate — Casting, finally built for actors."/>
  <meta property="og:description" content="Every headshot seen. Guaranteed. Join the casting platform built for working actors."/>
  <meta property="og:type" content="website"/>
  <link rel="icon" href="/favicon.ico?v=2" sizes="any"/>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2"/>
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2"/>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
  <script>
    window.SC_CONFIG = {{
      SUPABASE_URL: "https://mvqhqbjjvgkftninjcby.supabase.co",
      SUPABASE_ANON_KEY: "sb_publishable_J8nl68IlCex_G9sjNQX1kQ_vsb7AzNc",
      ADMIN_EMAIL: "officecasting01@gmail.com"
    }};
    window.sb = window.supabase.createClient(window.SC_CONFIG.SUPABASE_URL, window.SC_CONFIG.SUPABASE_ANON_KEY);
  </script>
  <!-- BUILD: {BUILD_VERSION} -->
  <meta name="build-version" content="{BUILD_VERSION}"/>
  <script>
    /* Force reload when a new deploy lands; also clears BFCache stale state */
    (function(){{
      var B="{BUILD_VERSION}";
      var prev=localStorage.getItem("sc_bv");
      localStorage.setItem("sc_bv",B);
      if(prev&&prev!==B){{window.location.reload();}}
      window.addEventListener("pageshow",function(e){{if(e.persisted)window.location.reload();}});
    }})();
  </script>
  <style>
    @keyframes cs-spin{{to{{transform:rotate(360deg)}}}}
    #cs-loading{{
      position:fixed;top:0;right:0;bottom:0;left:0;background:#1B1C20;
      display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;
      -webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;
      gap:18px;z-index:99999;-webkit-transition:opacity .3s;transition:opacity .3s;
    }}
    #cs-loading.hide{{opacity:0;pointer-events:none;}}
    #cs-loading .spinner{{
      width:42px;height:42px;border-radius:50%;
      border:3px solid rgba(255,255,255,0.08);
      border-top-color:#6366f1;
      animation:cs-spin .8s linear infinite;
    }}
    #cs-loading .label{{color:rgba(255,255,255,0.45);font-size:13px;font-family:-apple-system,sans-serif;letter-spacing:.3px;}}
    #cs-loading .logo{{color:#fff;font-size:22px;font-weight:800;font-family:-apple-system,sans-serif;letter-spacing:-0.5px;}}
    #cs-error{{
      display:none;position:fixed;top:0;right:0;bottom:0;left:0;background:#1B1C20;
      -webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;
      -webkit-flex-direction:column;flex-direction:column;
      gap:12px;padding:32px;text-align:center;z-index:99999;
    }}
    #cs-error .err-title{{color:#fff;font-size:18px;font-weight:700;font-family:-apple-system,sans-serif;}}
    #cs-error .err-msg{{color:rgba(255,255,255,0.5);font-size:13px;font-family:-apple-system,sans-serif;line-height:1.6;}}
    #cs-error button{{background:#6366f1;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:-apple-system,sans-serif;margin-top:8px;}}
  </style>
</head>
<body>
  <!-- Loading indicator — shown until React mounts -->
  <div id="cs-loading">
    <div class="logo">CastSlate</div>
    <div class="spinner"></div>
    <div class="label">Loading…</div>
  </div>
  <!-- Error screen — shown if something goes wrong -->
  <div id="cs-error">
    <div class="err-title">Something went wrong</div>
    <div class="err-msg">CastSlate couldn't start. Please try refreshing the page.</div>
    <button onclick="window.location.reload()">Reload</button>
  </div>
  <div id="root"></div>
  <script>
    /* ── Runtime error infrastructure ───────────────────────────────────────
       Errors BEFORE React mounts  →  show full crash screen (fatal).
       Errors AFTER  React mounts  →  ErrorBoundary catches them in-section;
                                       the global handler only logs + collects.
       window.__CS_REACT_MOUNTED is set to true by App's first useEffect.
    ──────────────────────────────────────────────────────────────────────── */
    window.__CS_LOADING_STARTED = Date.now();
    window.__CS_REACT_MOUNTED   = false;
    window.__SC_ERR             = [];   // collects all errors for ?debug panel

    window.__CS_HIDE_LOADING = function(){{
      var el = document.getElementById('cs-loading');
      if(el){{ el.classList.add('hide'); setTimeout(function(){{el.style.display='none';}},350); }}
    }};

    /* Uncaught JS errors (syntax, TDZ, undefined, bad JSX eval) */
    window.addEventListener('error', function(e){{
      var msg = (e.message||'unknown') + ' (' + (e.filename||'?') + ':' + (e.lineno||0) + ')';
      window.__SC_ERR.push({{type:'error', msg:msg, ts:new Date().toISOString()}});
      console.error('[CS error]', msg);
      /* Only show crash screen if React hasn't mounted yet (pre-mount fatal) */
      if(!window.__CS_REACT_MOUNTED){{
        document.getElementById('cs-loading').style.display='none';
        document.getElementById('cs-error').style.display='flex';
      }}
    }});

    /* Unhandled promise rejections (async data fetches, Supabase calls, etc.) */
    window.addEventListener('unhandledrejection', function(e){{
      var msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason||'unknown rejection');
      window.__SC_ERR.push({{type:'rejection', msg:msg, ts:new Date().toISOString()}});
      console.error('[CS unhandled rejection]', msg);
      /* Never show crash screen for async rejections — ErrorBoundary handles render errors */
    }});

    /* Safety timeout — if React hasn't rendered in 30s show error */
    setTimeout(function(){{
      var root = document.getElementById('root');
      if(!root || !root.firstChild){{
        document.getElementById('cs-loading').style.display='none';
        document.getElementById('cs-error').style.display='flex';
      }}
    }}, 30000);
  </script>
  <script type="text/babel" data-presets="react">
{jsx_content}
  </script>
</body>
</html>'''

open("index.html", "w").write(html)
print(f"Done — BUILD: {BUILD_VERSION}")
