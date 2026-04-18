jsx_content = open("swipecast-full.jsx", "r").read()
# Strip the ES module `import` line — Babel standalone in the browser can't resolve imports
import re
jsx_content = re.sub(r'^\s*import\s+.*?from\s+["\'][^"\']+["\'];?\s*\n', '', jsx_content, count=1, flags=re.MULTILINE)
# Replace `export default function App` with plain `function App`
jsx_content = jsx_content.replace("export default function App", "function App")
# Inject the React hooks destructure at the top so useState etc. work in-browser
jsx_content = "const { useState, useRef, useCallback, useEffect } = React;\n" + jsx_content
# Render the App at the end
jsx_content += "\nReactDOM.createRoot(document.getElementById('root')).render(<App />);\n"

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>SwipeCast — Casting, finally built for actors.</title>
  <meta name="description" content="SwipeCast is the casting platform where every submission gets seen. Free forever for actors. Trusted by CDs across film, TV, theater, and commercials."/>
  <meta property="og:title" content="SwipeCast — Casting, finally built for actors."/>
  <meta property="og:description" content="Every headshot seen. Guaranteed. Join the casting platform built for working actors."/>
  <meta property="og:type" content="website"/>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
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
  <script type="text/babel">
{jsx_content}
  </script>
</body>
</html>'''

open("index.html", "w").write(html)
print("Done")
