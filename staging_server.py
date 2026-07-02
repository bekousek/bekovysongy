#!/usr/bin/env python3
"""Tiny localhost sink: the browser POSTs extracted song sheets here and we
write them to staging/<slug>.src.txt. Keeps song text out of the chat.
Handles Chrome Private Network Access preflight (public https -> localhost)."""
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
STAGING = os.path.join(ROOT, "staging")
os.makedirs(STAGING, exist_ok=True)

SLUG_RE = re.compile(r"^[a-z0-9-]+$")


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)
        slug = (q.get("slug", [""])[0]).strip()
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8", "replace")
        ok = bool(SLUG_RE.match(slug)) and len(body) > 20
        if ok:
            with open(os.path.join(STAGING, slug + ".src.txt"), "w", encoding="utf-8") as f:
                f.write(body)
        msg = f"{'saved' if ok else 'rejected'} {slug} {len(body)}b".encode()
        self.send_response(200 if ok else 400)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8765), H).serve_forever()
