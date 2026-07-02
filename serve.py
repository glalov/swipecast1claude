import http.server
import os
import socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


class CastSlatePreviewHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) and "." not in os.path.basename(self.path.split("?", 1)[0]):
            self.path = "/index.html"
        return super().send_head()


class ReusableThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


with ReusableThreadingServer(("", 8000), CastSlatePreviewHandler) as server:
    print("CastSlate preview: http://127.0.0.1:8000/index.html")
    server.serve_forever()
