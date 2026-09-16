#!/usr/bin/env python3
"""Sprite picker - local review tool for choosing the winning variant of each
generated creature sprite set.

Serves the web UI in web/ and a tiny JSON API over the sprite tree at
    G:\\ClaudesFolder\\dungeon-crawlers\\Sprites\\dnd_enemies

Layout it expects:
    <root>/<creature>/final_64/<creature>_NN.png   (64x64 game-ready)
    <root>/<creature>/raw/<creature>_NN_raw.png    (512x512 pre-downscale)

Picks are stored in <root>/selections.json and exported (copied) to
<root>/selected/<creature>.png on demand.

Usage:  python server.py [--root PATH] [--port 8765] [--no-browser]
"""

import argparse
import json
import mimetypes
import os
import posixpath
import re
import shutil
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_ROOT = Path(r"G:\ClaudesFolder\dungeon-crawlers\Sprites\dnd_enemies")
HERE = Path(__file__).resolve().parent
WEB_DIR = HERE / "web"

VARIANT_RE = re.compile(r"_(\d+)(?:_raw)?\.png$", re.IGNORECASE)
NAME_OK = re.compile(r"^[A-Za-z0-9_\-. ']+$")

# ---------------------------------------------------------------- state ----


class Store:
    """selections.json, loaded once and written atomically on every change."""

    def __init__(self, root: Path):
        self.root = root
        self.path = root / "selections.json"
        self.lock = threading.Lock()
        self.data = {"picks": {}, "flags": {}, "notes": {}}
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                for key in self.data:
                    if isinstance(loaded.get(key), dict):
                        self.data[key] = loaded[key]
            except (OSError, ValueError) as exc:
                print(f"[warn] could not read {self.path}: {exc}")

    def save(self):
        tmp = self.path.with_suffix(".json.tmp")
        payload = dict(self.data)
        payload["_updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(self.path)

    def set_pick(self, creature, variant):
        with self.lock:
            if variant is None:
                self.data["picks"].pop(creature, None)
            else:
                self.data["picks"][creature] = variant
                self.data["flags"].pop(creature, None)
            self.save()

    def set_flag(self, creature, flagged):
        with self.lock:
            if flagged:
                self.data["flags"][creature] = True
                self.data["picks"].pop(creature, None)
            else:
                self.data["flags"].pop(creature, None)
            self.save()

    def set_note(self, creature, note):
        with self.lock:
            if note:
                self.data["notes"][creature] = note
            else:
                self.data["notes"].pop(creature, None)
            self.save()


# ------------------------------------------------------------- scanning ----


def scan(root: Path):
    """Build the creature -> variants manifest. Cheap enough to redo on demand."""
    creatures = []
    for entry in sorted(os.scandir(root), key=lambda e: e.name.lower()):
        if not entry.is_dir() or entry.name in ("selected", "__pycache__"):
            continue
        final_dir = Path(entry.path) / "final_64"
        if not final_dir.is_dir():
            continue
        variants = []
        for f in sorted(os.scandir(final_dir), key=lambda e: e.name.lower()):
            if not f.is_file() or not f.name.lower().endswith(".png"):
                continue
            m = VARIANT_RE.search(f.name)
            raw_name = f.name[:-4] + "_raw.png"
            has_raw = (Path(entry.path) / "raw" / raw_name).is_file()
            variants.append(
                {
                    "file": f.name,
                    "n": int(m.group(1)) if m else len(variants) + 1,
                    "raw": raw_name if has_raw else None,
                }
            )
        if variants:
            creatures.append({"name": entry.name, "variants": variants})
    return creatures


def safe_join(root: Path, *parts):
    """Join user-supplied path pieces, refusing anything that escapes root."""
    for p in parts:
        if not p or not NAME_OK.match(p) or ".." in p:
            return None
    target = root.joinpath(*parts).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None
    return target


# -------------------------------------------------------------- handler ----


class Handler(BaseHTTPRequestHandler):
    server_version = "SpritePicker/1.0"
    root: Path = DEFAULT_ROOT
    store: Store = None

    def log_message(self, fmt, *args):  # quieter console
        if "/api/" in (self.path or ""):
            print("%s - %s" % (self.log_date_time_string(), fmt % args))

    # -- helpers --

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, cache=True):
        if not path or not path.is_file():
            self.send_error(404, "not found")
            return
        data = path.read_bytes()
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header(
            "Cache-Control", "public, max-age=86400" if cache else "no-store"
        )
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return {}

    # -- routes --

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/" or path == "/index.html":
            self.send_file(WEB_DIR / "index.html", cache=False)
            return

        if path.startswith("/static/"):
            name = posixpath.basename(path)
            self.send_file(WEB_DIR / name, cache=False)
            return

        if path == "/api/manifest":
            self.send_json(
                {
                    "root": str(self.root),
                    "creatures": scan(self.root),
                    "picks": self.store.data["picks"],
                    "flags": self.store.data["flags"],
                    "notes": self.store.data["notes"],
                }
            )
            return

        # /img/<creature>/<final_64|raw>/<file.png>
        if path.startswith("/img/"):
            parts = path[len("/img/") :].split("/")
            if len(parts) != 3 or parts[1] not in ("final_64", "raw"):
                self.send_error(400, "bad image path")
                return
            self.send_file(safe_join(self.root, *parts))
            return

        self.send_error(404, "not found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_json()
        creature = body.get("creature")

        if path == "/api/pick":
            if not creature or not NAME_OK.match(creature):
                self.send_json({"ok": False, "error": "bad creature"}, 400)
                return
            self.store.set_pick(creature, body.get("file"))
            self.send_json({"ok": True, "picks": self.store.data["picks"]})
            return

        if path == "/api/flag":
            if not creature or not NAME_OK.match(creature):
                self.send_json({"ok": False, "error": "bad creature"}, 400)
                return
            self.store.set_flag(creature, bool(body.get("flagged")))
            self.send_json({"ok": True, "flags": self.store.data["flags"]})
            return

        if path == "/api/note":
            if not creature or not NAME_OK.match(creature):
                self.send_json({"ok": False, "error": "bad creature"}, 400)
                return
            self.store.set_note(creature, (body.get("note") or "").strip()[:500])
            self.send_json({"ok": True})
            return

        if path == "/api/export":
            self.send_json(self.export(bool(body.get("include_raw"))))
            return

        self.send_error(404, "not found")

    # -- export --

    def export(self, include_raw=False):
        out = self.root / "selected"
        out.mkdir(exist_ok=True)
        raw_out = self.root / "selected_raw"
        if include_raw:
            raw_out.mkdir(exist_ok=True)

        copied, missing = 0, []
        for creature, filename in sorted(self.store.data["picks"].items()):
            src = safe_join(self.root, creature, "final_64", filename)
            if not src or not src.is_file():
                missing.append(creature)
                continue
            shutil.copy2(src, out / f"{creature}.png")
            copied += 1
            if include_raw:
                raw_src = safe_join(
                    self.root, creature, "raw", filename[:-4] + "_raw.png"
                )
                if raw_src and raw_src.is_file():
                    shutil.copy2(raw_src, raw_out / f"{creature}.png")
        return {
            "ok": True,
            "copied": copied,
            "missing": missing,
            "dest": str(out),
        }


def main():
    ap = argparse.ArgumentParser(description="Sprite picker review server")
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help="sprite tree root")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        raise SystemExit(f"root not found: {root}")

    Handler.root = root
    Handler.store = Store(root)

    manifest = scan(root)
    picked = len(Handler.store.data["picks"])
    print(f"Sprite picker")
    print(f"  root      {root}")
    print(f"  creatures {len(manifest)}  ({picked} already picked)")
    print(f"  selections {Handler.store.path}")

    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"  serving   {url}   (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
