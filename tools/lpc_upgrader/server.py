"""
HTTP & JSON API Server for the LPC 128x128 Production Orchestrator Studio.

Run with:
    python tools/lpc_upgrader/server.py

Serves:
- http://127.0.0.1:8765/         -> Orchestrator HTML App (`index.html`)
- http://127.0.0.1:8765/lpc/...  -> Original 64x64 sheets (`public/lpc/`)
- http://127.0.0.1:8765/lpc_128/ -> Upgraded 128x128 sheets (`public/lpc_128/`)
- http://127.0.0.1:8765/cache/   -> Cached isolated ComfyUI input/output sheets
- /api/*                         -> REST endpoints for catalog, queue, worker, & params
"""

import os
import sys
import json
import mimetypes
import urllib.parse
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.lpc_upgrader.pipeline_engine import (
    PipelineOrchestrator,
    SRC_LPC_ROOT,
    DST_LPC_ROOT,
    CACHE_DIR,
    TOOL_DIR,
    COMFY_IN_DIR,
    COMFY_OUT_DIR,
)

PORT = int(os.environ.get("LPC_ORCH_PORT", "8765"))
ORCHESTRATOR = PipelineOrchestrator()


class OrchestratorRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Keep console clean; API actions already log to ORCHESTRATOR.logs
        pass

    def _send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, file_path: Path):
        if not file_path.exists() or not file_path.is_file():
            self.send_response(404)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return
        ctype, _ = mimetypes.guess_type(str(file_path))
        if not ctype:
            ctype = "application/octet-stream"
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            return self._serve_file(TOOL_DIR / "index.html")

        if path == "/api/status":
            return self._send_json(ORCHESTRATOR.get_summary_stats())

        if path == "/api/catalog":
            ORCHESTRATOR.refresh_disk_status()
            with ORCHESTRATOR.lock:
                items = list(ORCHESTRATOR.catalog.values())
            return self._send_json({"items": items})

        if path == "/api/item":
            item_id = qs.get("id", [""])[0]
            ORCHESTRATOR.refresh_disk_status()
            with ORCHESTRATOR.lock:
                item = ORCHESTRATOR.catalog.get(item_id)
            if not item:
                return self._send_json({"error": f"Unknown item: {item_id}"}, status=404)

            slug = item_id.replace("/", "__")
            cached_tiles = []
            if COMFY_OUT_DIR.exists():
                for out_f in sorted(COMFY_OUT_DIR.glob(f"{slug}_*_out.png")):
                    key = out_f.name[: -len("_out.png")]
                    cached_tiles.append({
                        "cache_key": key,
                        "in_url": f"/cache/comfy_in/{key}_in.png",
                        "out_url": f"/cache/comfy_out/{key}_out.png",
                    })
            return self._send_json({"item": item, "cached_tiles": cached_tiles})

        if path.startswith("/lpc_128/"):
            rel = path[len("/lpc_128/") :]
            target = (DST_LPC_ROOT / rel).resolve()
            if str(target).startswith(str(DST_LPC_ROOT.resolve())):
                return self._serve_file(target)

        if path.startswith("/lpc/"):
            rel = path[len("/lpc/") :]
            target = (SRC_LPC_ROOT / rel).resolve()
            if str(target).startswith(str(SRC_LPC_ROOT.resolve())):
                return self._serve_file(target)

        if path.startswith("/cache/"):
            rel = path[len("/cache/") :]
            target = (CACHE_DIR / rel).resolve()
            if str(target).startswith(str(CACHE_DIR.resolve())):
                return self._serve_file(target)

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}

        if path == "/api/queue/add":
            ids = body.get("ids", [])
            tier = body.get("tier")
            category = body.get("category")
            force = bool(body.get("force", False))
            prioritize = bool(body.get("prioritize", False))

            if tier:
                with ORCHESTRATOR.lock:
                    ids = [i["id"] for i in ORCHESTRATOR.catalog.values() if i["tier"] == tier]
            elif category:
                with ORCHESTRATOR.lock:
                    ids = [i["id"] for i in ORCHESTRATOR.catalog.values() if i["category"] == category]

            added = ORCHESTRATOR.enqueue(ids, force=force, prioritize=prioritize)
            return self._send_json({"ok": True, "added": added, "status": ORCHESTRATOR.get_summary_stats()})

        if path == "/api/queue/remove":
            ids = body.get("ids", [])
            ORCHESTRATOR.remove_from_queue(ids)
            return self._send_json({"ok": True, "status": ORCHESTRATOR.get_summary_stats()})

        if path == "/api/queue/clear":
            ORCHESTRATOR.clear_queue()
            return self._send_json({"ok": True, "status": ORCHESTRATOR.get_summary_stats()})

        if path == "/api/worker/start":
            ORCHESTRATOR.start_worker()
            return self._send_json({"ok": True, "status": ORCHESTRATOR.get_summary_stats()})

        if path == "/api/worker/stop":
            interrupt = bool(body.get("interrupt", True))
            ORCHESTRATOR.stop_worker(interrupt_comfy=interrupt)
            return self._send_json({"ok": True, "status": ORCHESTRATOR.get_summary_stats()})

        if path == "/api/item/params":
            ids = body.get("ids", [])
            category = body.get("category")
            params = body.get("params", {})
            if category and not ids:
                with ORCHESTRATOR.lock:
                    ids = [i["id"] for i in ORCHESTRATOR.catalog.values() if i["category"] == category]
            ORCHESTRATOR.update_params(ids, params)
            if body.get("requeue"):
                ORCHESTRATOR.enqueue(ids, force=True, prioritize=True)
            return self._send_json({"ok": True, "updated": len(ids), "status": ORCHESTRATOR.get_summary_stats()})

        if path == "/api/scan":
            ORCHESTRATOR.load_or_scan_catalog(force_rescan=bool(body.get("full", False)))
            return self._send_json({"ok": True, "status": ORCHESTRATOR.get_summary_stats()})

        return self._send_json({"error": f"Unknown endpoint: {path}"}, status=404)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), OrchestratorRequestHandler)
    print(f"LPC 128x128 Orchestrator Studio running at http://127.0.0.1:{PORT}/")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

