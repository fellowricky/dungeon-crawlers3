"""Queue an icon batch file (from build_manifest.mjs) on the locked Krea2 recipe.

    python queue_batch.py batch_status12.json

512 square, 8 steps, CFG 1.0, euler/simple, batch_size 4 -- the monster-pipeline
recipe unchanged except the canvas: icons end up ~32px, so 1024 detail is thrown
away by the downscale (verified against a 1024 control).
"""
import copy, json, os, sys, time, urllib.request, urllib.error

COMFY = "http://192.168.2.19:8188"
WF = r"C:\Users\fello\.claude\skills\monster-animation-pipeline\workflows\krea2_base_1024.json"
ROOT = os.path.dirname(os.path.abspath(__file__))
SIZE, VARIANTS = 512, 4


def post(path, data=None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        COMFY + path, data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def main():
    batch = json.load(open(os.path.join(ROOT, sys.argv[1]), encoding="utf-8"))
    base = json.load(open(WF, encoding="utf-8"))
    try:
        post("/free", {"unload_models": True, "free_memory": True})
    except Exception as e:
        print("free skipped:", e, flush=True)

    queued = {}
    for ic in batch:
        wf = copy.deepcopy(base)
        wf["5"]["inputs"]["text"] = ic["prompt"]
        wf["8"]["inputs"].update(seed=ic["seed"], cfg=1.0, steps=8,
                                 sampler_name="euler", scheduler="simple")
        wf["7"]["inputs"].update(width=SIZE, height=SIZE, batch_size=VARIANTS)
        wf["10"]["inputs"]["filename_prefix"] = "DC_icons/" + ic["id"]
        try:
            res = post("/prompt", {"prompt": wf})
        except urllib.error.HTTPError as e:
            print(ic["id"], "QUEUE FAILED", e.read().decode("utf-8")[:500])
            return 1
        if res.get("node_errors"):
            print(ic["id"], "NODE ERRORS", json.dumps(res["node_errors"])[:500])
            return 1
        queued[res["prompt_id"]] = ic["id"]
        print("queued", ic["id"], flush=True)

    start = time.time()
    while queued and time.time() - start < 7200:
        time.sleep(6)
        for pid in list(queued):
            try:
                hist = post("/history/%s" % pid)
            except Exception:
                continue
            if pid in hist:
                ok = hist[pid].get("status", {}).get("status_str") == "success"
                print("%-28s %s" % (queued[pid], "done" if ok else "FAILED"), flush=True)
                queued.pop(pid)
    print("ALL DONE" if not queued else "TIMED OUT: %s" % list(queued.values()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
