#!/usr/bin/env python3
"""Static preview server for the Firebase-backed Apex Polycoat website."""

from __future__ import annotations

import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent


class StaticHandler(BaseHTTPRequestHandler):
    server_version = "ApexStatic/2.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self' https://www.gstatic.com https://*.googleapis.com https://*.firebaseio.com https://*.firebasestorage.app https://firebasestorage.googleapis.com; "
            "img-src 'self' data: blob: https://*.googleusercontent.com https://*.firebasestorage.app https://firebasestorage.googleapis.com; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' https://www.gstatic.com; "
            "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firebasestorage.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; "
            "object-src 'none'; base-uri 'self'; form-action 'self'"
        )
        super().end_headers()

    def do_GET(self) -> None:
        self.handle_request(send_body=True)

    def do_HEAD(self) -> None:
        self.handle_request(send_body=False)

    def handle_request(self, *, send_body: bool) -> None:
        path = unquote(urlparse(self.path).path)
        if path == "/admin":
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", "/admin.html")
            self.end_headers()
            return
        self.serve_static(path, send_body=send_body)

    def serve_static(self, path: str, *, send_body: bool) -> None:
        requested = "index.html" if path in {"", "/"} else path.lstrip("/")
        if requested == "server.py" or requested.startswith("."):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            target = (ROOT / requested).resolve()
            target.relative_to(ROOT)
        except (ValueError, OSError):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = target.read_bytes()
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{mime}; charset=utf-8" if mime.startswith(("text/", "application/javascript")) else mime)
        self.send_header("Content-Length", str(len(content)))
        if target.suffix in {".html", ".js", ".css"}:
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        if send_body:
            self.wfile.write(content)


def main() -> None:
    host = os.environ.get("APEX_HOST", "127.0.0.1")
    port = int(os.environ.get("APEX_PORT", "4173"))
    server = ThreadingHTTPServer((host, port), StaticHandler)
    print(f"Apex website: http://{host}:{port}")
    print(f"Admin console: http://{host}:{port}/admin")
    print("Firebase handles products, site settings, admin auth, and uploads.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
