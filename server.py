#!/usr/bin/env python3
"""Apex Polycoat website server with an authenticated SQLite admin API."""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
import threading
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "apex.db"
SESSION_COOKIE = "apex_admin_session"
SESSION_TTL = 8 * 60 * 60
PASSWORD_ITERATIONS = 600_000
MAX_BODY = 256_000

SESSIONS: dict[str, float] = {}
FAILED_LOGINS: dict[str, list[float]] = {}
STATE_LOCK = threading.Lock()

SEED_PRODUCTS = [
    ("Veloce Grain", "APX 101", "automotive", "#823d28", "Balanced softness and surface resilience for seating and trim.", ["Low gloss", "Fine grain", "Durable"]),
    ("Atelier Pebble", "APX 204", "furnishing", "#384537", "Rich pebble character with a warm, supple handle.", ["Soft touch", "Pebble", "Easy care"]),
    ("Stride Flex", "APX 307", "footwear", "#c2a376", "Flexible, clean-finishing surface developed for daily movement.", ["Flexible", "Matte", "Consistent"]),
    ("Studio Nappa", "APX 412", "lifestyle", "#293b48", "A smooth contemporary finish for bags and small leather goods.", ["Smooth", "Supple", "Versatile"]),
    ("Contract Weave", "APX 218", "furnishing", "#d1c6ad", "A textile-inspired grain for hospitality and high-use interiors.", ["Textile grain", "Contract", "Cleanable"]),
    ("Carbon Micro", "APX 126", "automotive", "#262626", "Technical micro-texture with a controlled, modern sheen.", ["Micro grain", "Technical", "Low sheen"]),
    ("Form Classic", "APX 329", "footwear", "#752d32", "Timeless grain and rich colour for structured footwear uppers.", ["Structured", "Rich colour", "Embossable"]),
    ("Craft Suede", "APX 436", "lifestyle", "#aa7542", "A soft, directional surface with understated visual depth.", ["Soft nap", "Warm touch", "Crafted"]),
    ("Terra Matte", "APX 241", "furnishing", "#6d7067", "Quiet, mineral-inspired colour and an architectural matte finish.", ["Ultra matte", "Modern", "Soft hand"]),
]

DEFAULT_SITE = {
    "company_name": "Apex Polycoat Solutions",
    "email": "",
    "phone": "",
    "address": "",
    "footer_description": "Performance leatherette and coated fabric solutions developed for modern products and spaces.",
}


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialise_database() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                code TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL CHECK(category IN ('automotive','furnishing','footwear','lifestyle')),
                swatch TEXT NOT NULL,
                description TEXT NOT NULL,
                properties TEXT NOT NULL DEFAULT '[]',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS site_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS admin_auth (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        count = connection.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        if count == 0:
            connection.executemany(
                "INSERT INTO products (name, code, category, swatch, description, properties, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(name, code, category, swatch, description, json.dumps(properties), index) for index, (name, code, category, swatch, description, properties) in enumerate(SEED_PRODUCTS)],
            )
        connection.executemany(
            "INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)",
            DEFAULT_SITE.items(),
        )


def password_digest(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS).hex()


def set_password(password: str) -> None:
    salt = secrets.token_bytes(32)
    digest = password_digest(password, salt)
    with db() as connection:
        connection.execute(
            "INSERT INTO admin_auth (id, salt, password_hash, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(id) DO UPDATE SET salt=excluded.salt, password_hash=excluded.password_hash, updated_at=CURRENT_TIMESTAMP",
            (salt.hex(), digest),
        )
    with STATE_LOCK:
        SESSIONS.clear()


def auth_configured() -> bool:
    with db() as connection:
        return connection.execute("SELECT 1 FROM admin_auth WHERE id = 1").fetchone() is not None


def verify_password(password: str) -> bool:
    with db() as connection:
        row = connection.execute("SELECT salt, password_hash FROM admin_auth WHERE id = 1").fetchone()
    if not row:
        return False
    digest = password_digest(password, bytes.fromhex(row["salt"]))
    return hmac.compare_digest(digest, row["password_hash"])


def product_from_row(row: sqlite3.Row) -> dict:
    item = dict(row)
    item["properties"] = json.loads(item.get("properties") or "[]")
    return item


class ApexHandler(BaseHTTPRequestHandler):
    server_version = "ApexServer/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        super().end_headers()

    def send_json(self, payload: dict | list, status: int = 200, *, cookie: str | None = None) -> None:
        content = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(content)

    def read_json(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY or "application/json" not in self.headers.get("Content-Type", ""):
            return None
        try:
            value = json.loads(self.rfile.read(length))
            return value if isinstance(value, dict) else None
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlparse(origin)
        return parsed.netloc == self.headers.get("Host") and parsed.scheme in {"http", "https"}

    def session_token(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(raw)
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def authenticated(self) -> bool:
        token = self.session_token()
        if not token:
            return False
        now = time.time()
        with STATE_LOCK:
            expiry = SESSIONS.get(token, 0)
            if expiry <= now:
                SESSIONS.pop(token, None)
                return False
            SESSIONS[token] = now + SESSION_TTL
        return True

    def require_admin(self) -> bool:
        if not self.authenticated():
            self.send_json({"error": "Authentication required"}, HTTPStatus.UNAUTHORIZED)
            return False
        if self.command != "GET" and (not self.same_origin() or self.headers.get("X-Requested-With") != "ApexAdmin"):
            self.send_json({"error": "Invalid request origin"}, HTTPStatus.FORBIDDEN)
            return False
        return True

    def create_session(self) -> str:
        token = secrets.token_urlsafe(32)
        with STATE_LOCK:
            now = time.time()
            expired = [key for key, expiry in SESSIONS.items() if expiry <= now]
            for key in expired:
                SESSIONS.pop(key, None)
            SESSIONS[token] = now + SESSION_TTL
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}"

    def route(self) -> tuple[str, list[str]]:
        path = unquote(urlparse(self.path).path)
        return path, [part for part in path.split("/") if part]

    def do_GET(self) -> None:
        path, parts = self.route()
        if path == "/api/products":
            with db() as connection:
                products = [product_from_row(row) for row in connection.execute("SELECT * FROM products ORDER BY sort_order, id")]
            self.send_json({"products": products})
            return
        if path == "/api/site":
            with db() as connection:
                settings = {row["key"]: row["value"] for row in connection.execute("SELECT key, value FROM site_settings")}
            self.send_json({"site": settings})
            return
        if path == "/api/admin/status":
            self.send_json({"configured": auth_configured(), "authenticated": self.authenticated()})
            return
        if path == "/api/admin/products":
            if not self.require_admin(): return
            with db() as connection:
                products = [product_from_row(row) for row in connection.execute("SELECT * FROM products ORDER BY sort_order, id")]
            self.send_json({"products": products})
            return
        if path == "/api/admin/site":
            if not self.require_admin(): return
            with db() as connection:
                settings = {row["key"]: row["value"] for row in connection.execute("SELECT key, value FROM site_settings")}
            self.send_json({"site": settings})
            return
        if path == "/admin":
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", "/admin.html")
            self.end_headers()
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        path, parts = self.route()
        if path == "/api/admin/setup":
            if auth_configured():
                self.send_json({"error": "Administrator password is already configured"}, HTTPStatus.CONFLICT)
                return
            if not self.same_origin():
                self.send_json({"error": "Invalid request origin"}, HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json()
            password = payload.get("password", "") if payload else ""
            error = self.validate_password(password)
            if error:
                self.send_json({"error": error}, HTTPStatus.BAD_REQUEST)
                return
            set_password(password)
            self.send_json({"ok": True}, cookie=self.create_session())
            return
        if path == "/api/admin/login":
            if not auth_configured():
                self.send_json({"error": "Complete first-time setup"}, HTTPStatus.CONFLICT)
                return
            if not self.same_origin():
                self.send_json({"error": "Invalid request origin"}, HTTPStatus.FORBIDDEN)
                return
            ip = self.client_address[0]
            now = time.time()
            with STATE_LOCK:
                attempts = [stamp for stamp in FAILED_LOGINS.get(ip, []) if now - stamp < 60]
                FAILED_LOGINS[ip] = attempts
            if len(attempts) >= 5:
                self.send_json({"error": "Too many attempts. Try again in one minute."}, HTTPStatus.TOO_MANY_REQUESTS)
                return
            payload = self.read_json()
            password = payload.get("password", "") if payload else ""
            if not verify_password(password):
                with STATE_LOCK:
                    FAILED_LOGINS.setdefault(ip, []).append(now)
                time.sleep(.25)
                self.send_json({"error": "Incorrect password"}, HTTPStatus.UNAUTHORIZED)
                return
            with STATE_LOCK:
                FAILED_LOGINS.pop(ip, None)
            self.send_json({"ok": True}, cookie=self.create_session())
            return
        if path == "/api/admin/logout":
            token = self.session_token()
            if token:
                with STATE_LOCK: SESSIONS.pop(token, None)
            self.send_json({"ok": True}, cookie=f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
            return
        if path == "/api/admin/products":
            if not self.require_admin(): return
            payload = self.read_json()
            item, error = self.validate_product(payload)
            if error:
                self.send_json({"error": error}, HTTPStatus.BAD_REQUEST)
                return
            try:
                with db() as connection:
                    cursor = connection.execute("INSERT INTO products (name, code, category, swatch, description, properties, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)", item)
                    row = connection.execute("SELECT * FROM products WHERE id = ?", (cursor.lastrowid,)).fetchone()
                self.send_json({"product": product_from_row(row)}, HTTPStatus.CREATED)
            except sqlite3.IntegrityError:
                self.send_json({"error": "Product code must be unique"}, HTTPStatus.CONFLICT)
            return
        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_PUT(self) -> None:
        path, parts = self.route()
        if len(parts) == 4 and parts[:3] == ["api", "admin", "products"]:
            if not self.require_admin(): return
            try: product_id = int(parts[3])
            except ValueError:
                self.send_json({"error": "Invalid product id"}, HTTPStatus.BAD_REQUEST); return
            item, error = self.validate_product(self.read_json())
            if error:
                self.send_json({"error": error}, HTTPStatus.BAD_REQUEST); return
            try:
                with db() as connection:
                    cursor = connection.execute("UPDATE products SET name=?, code=?, category=?, swatch=?, description=?, properties=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (*item, product_id))
                    if not cursor.rowcount:
                        self.send_json({"error": "Product not found"}, HTTPStatus.NOT_FOUND); return
                    row = connection.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
                self.send_json({"product": product_from_row(row)})
            except sqlite3.IntegrityError:
                self.send_json({"error": "Product code must be unique"}, HTTPStatus.CONFLICT)
            return
        if path == "/api/admin/site":
            if not self.require_admin(): return
            payload = self.read_json()
            if not payload:
                self.send_json({"error": "Invalid settings"}, HTTPStatus.BAD_REQUEST); return
            cleaned = {}
            for key in DEFAULT_SITE:
                value = payload.get(key, "")
                if not isinstance(value, str) or len(value) > 500:
                    self.send_json({"error": f"Invalid value for {key}"}, HTTPStatus.BAD_REQUEST); return
                cleaned[key] = value.strip()
            with db() as connection:
                connection.executemany("INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", cleaned.items())
            self.send_json({"site": cleaned})
            return
        if path == "/api/admin/password":
            if not self.require_admin(): return
            payload = self.read_json()
            current = payload.get("current_password", "") if payload else ""
            new = payload.get("new_password", "") if payload else ""
            if not verify_password(current):
                self.send_json({"error": "Current password is incorrect"}, HTTPStatus.UNAUTHORIZED); return
            error = self.validate_password(new)
            if error:
                self.send_json({"error": error}, HTTPStatus.BAD_REQUEST); return
            set_password(new)
            self.send_json({"ok": True}, cookie=self.create_session())
            return
        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        path, parts = self.route()
        if len(parts) == 4 and parts[:3] == ["api", "admin", "products"]:
            if not self.require_admin(): return
            try: product_id = int(parts[3])
            except ValueError:
                self.send_json({"error": "Invalid product id"}, HTTPStatus.BAD_REQUEST); return
            with db() as connection:
                cursor = connection.execute("DELETE FROM products WHERE id = ?", (product_id,))
            if not cursor.rowcount:
                self.send_json({"error": "Product not found"}, HTTPStatus.NOT_FOUND); return
            self.send_json({"ok": True})
            return
        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    @staticmethod
    def validate_password(password: str) -> str | None:
        if not isinstance(password, str) or len(password) < 10:
            return "Password must be at least 10 characters"
        if len(password) > 200:
            return "Password is too long"
        return None

    @staticmethod
    def validate_product(payload: dict | None) -> tuple[tuple | None, str | None]:
        if not payload:
            return None, "Invalid product data"
        required = ("name", "code", "category", "swatch", "description")
        if any(not isinstance(payload.get(key), str) or not payload[key].strip() for key in required):
            return None, "Complete all required product fields"
        name, code = payload["name"].strip(), payload["code"].strip().upper()
        category, swatch = payload["category"].strip().lower(), payload["swatch"].strip()
        description = payload["description"].strip()
        if category not in {"automotive", "furnishing", "footwear", "lifestyle"}:
            return None, "Invalid category"
        if len(swatch) != 7 or not swatch.startswith("#") or any(char not in "0123456789abcdefABCDEF" for char in swatch[1:]):
            return None, "Swatch must be a valid hex colour"
        if len(name) > 80 or len(code) > 30 or len(description) > 500:
            return None, "One or more fields are too long"
        properties = payload.get("properties", [])
        if isinstance(properties, str):
            properties = [part.strip() for part in properties.split(",") if part.strip()]
        if not isinstance(properties, list) or len(properties) > 8 or any(not isinstance(value, str) or len(value) > 40 for value in properties):
            return None, "Invalid properties"
        try: sort_order = int(payload.get("sort_order", 0))
        except (TypeError, ValueError): sort_order = 0
        sort_order = max(0, min(sort_order, 9999))
        return (name, code, category, swatch.lower(), description, json.dumps(properties), sort_order), None

    def serve_static(self, path: str) -> None:
        requested = "index.html" if path in {"", "/"} else path.lstrip("/")
        if requested.startswith("data/") or requested in {"server.py"} or requested.startswith("."):
            self.send_error(HTTPStatus.NOT_FOUND); return
        try:
            target = (ROOT / requested).resolve()
            target.relative_to(ROOT)
        except (ValueError, OSError):
            self.send_error(HTTPStatus.NOT_FOUND); return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND); return
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
        self.wfile.write(content)


def main() -> None:
    initialise_database()
    host = os.environ.get("APEX_HOST", "127.0.0.1")
    port = int(os.environ.get("APEX_PORT", "4173"))
    server = ThreadingHTTPServer((host, port), ApexHandler)
    print(f"Apex website: http://{host}:{port}")
    print(f"Admin console: http://{host}:{port}/admin")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
