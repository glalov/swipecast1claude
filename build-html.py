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
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
{jsx_content}
  </script>
</body>
</html>'''

open("index.html", "w").write(html)
print(f"Done — BUILD: {BUILD_VERSION}")
