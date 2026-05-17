jsx_content = open("swipecast-full.jsx", "r").read()
# Strip the ES module `import` line — Babel standalone in the browser can't resolve imports
import re
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
  <title>SlateCue — Casting, finally built for actors.</title>
  <meta name="description" content="SlateCue is the casting platform where every submission gets seen. Free forever for actors. Trusted by CDs across film, TV, theater, and commercials."/>
  <meta property="og:title" content="SlateCue — Casting, finally built for actors."/>
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
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
{jsx_content}
  </script>
</body>
</html>'''

open("index.html", "w").write(html)
print("Done")
