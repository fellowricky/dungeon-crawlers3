"""
LPC 64x64 -> 128x128 Krea2 Modular Paper-Doll Production Pipeline Engine.

Provides:
1. Full catalog discovery & manifest tracking across all 423 item directories
   (2,694 sprite sheets) in `public/lpc/`, mirroring 1:1 into `public/lpc_128/`.
2. Two specialized, lossless-alpha isolated paper-doll compilers:
   - `head_static_4dir`: For all head-anchored items (`head`, `hair`, `hat`,
     `beards`, `eyes`). Applies Scale2x + 0.75x heroic head scaling anchored at
     the universal neck pivot (64, 70), packs all 4 directions onto an isolated
     #141218 paper-doll sheet (1 ComfyUI pass), and stamps out all 7+ animation
     sheets (`idle`, `walk`, `slash`, `thrust`, `shoot`, `spellcast`, `hurt`, etc.)
     using exact neck translation offsets.
   - `animated_packed`: For all animated body, equipment, shield, cape, and
     weapon items. Applies Scale2x, deduplicates identical frame patches across
     all sheets of an item, exploits Row 3 <-> Row 1 horizontal symmetry, packs
     unique isolated patches into 2x2 (4/pass), 1x2 (2/pass), or 1x1 (1/pass)
     #141218 paper-doll sheets, runs ComfyUI, and reassembles 4-direction sheets
     with exact Scale2x binary alpha masks (0 gray halo pixels, 0 interior holes).
3. Resumable background QueueWorker thread controlled by the HTML Orchestrator UI.
"""

import os
import json
import time
import glob
import shutil
import hashlib
import urllib.request
import urllib.parse
import threading
from pathlib import Path
import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SRC_LPC_ROOT = REPO_ROOT / "public" / "lpc"
DST_LPC_ROOT = REPO_ROOT / "public" / "lpc_128"
TOOL_DIR = Path(__file__).resolve().parent
CACHE_DIR = TOOL_DIR / "cache"
COMFY_IN_DIR = CACHE_DIR / "comfy_in"
COMFY_OUT_DIR = CACHE_DIR / "comfy_out"
MANIFEST_PATH = TOOL_DIR / "catalog_manifest.json"
WORKFLOW_TEMPLATE_PATH = REPO_ROOT / "scratch" / "lpc_upscale_poc" / "krea2_lpc_img2img_1024.json"

COMFY_URL = "http://127.0.0.1:8188"
BG_COLOR = (20, 18, 24)  # #141218 dark dungeon slate

HEAD_CATEGORIES = {"hair", "hat", "head", "beards", "eyes"}

CATEGORY_PROMPTS = {
    "body": "pixel artisolated headless character body and limbs sprite sheet on dark background, detailed muscular anatomy, shaded skin tones, hand-crafted dark fantasy RPG pixel art, crisp pixel grid",
    "head": "pixel art isolated character heads sprite sheet on dark background, 4 directions, shaded facial features, hand-crafted dark fantasy RPG pixel art, crisp pixel grid",
    "eyes": "pixel art character eyes sprite sheet on dark background, crisp pixel art",
    "beards": "pixel art isolated character beard and facial hair sprite sheet on dark background, 4 directions, textured hair strands, dark fantasy RPG pixel art, crisp pixel grid",
    "hair": "pixel art isolated character hair wig sprite sheet on dark background, 4 directions, volumetric shaded hair strands, dark fantasy RPG pixel art, crisp pixel grid",
    "hat": "pixel art isolated medieval helmet and headgear sprite sheet on dark background, 4 directions, weathered forged steel and brass trim, dark fantasy RPG pixel art, crisp pixel grid",
    "torso": "pixel art isolated medieval torso armor and tunic sprite sheet on dark background, 4 directions, weathered leather and forged steel plates, rivets, dark fantasy RPG pixel art, crisp pixel grid",
    "legs": "pixel art isolated medieval leg armor and trousers sprite sheet on dark background, cloth folds and knee guards, dark fantasy RPG pixel art, crisp pixel grid",
    "feet": "pixel art isolated medieval boots and greaves sprite sheet on dark background, worn leather and steel buckles, dark fantasy RPG pixel art, crisp pixel grid",
    "shoulders": "pixel art isolated shoulder pauldrons armor sprite sheet on dark background, forged steel plates and straps, dark fantasy RPG pixel art, crisp pixel grid",
    "arms": "pixel art isolated bracers and gauntlets armor sprite sheet on dark background, forged metal and leather straps, dark fantasy RPG pixel art, crisp pixel grid",
    "cape": "pixel art isolated flowing cloak and cape sprite sheet on dark background, rich weathered fabric folds, dark fantasy RPG pixel art, crisp pixel grid",
    "cape_behind": "pixel art isolated back cloak and cape sprite sheet on dark background, rich weathered fabric folds, dark fantasy RPG pixel art, crisp pixel grid",
    "shield": "pixel art isolated medieval shield sprite sheet on dark background, battle-worn wood and forged iron rim, dark fantasy RPG pixel art, crisp pixel grid",
    "shield_behind": "pixel art isolated medieval shield back sprite sheet on dark background, battle-worn wood and iron straps, dark fantasy RPG pixel art, crisp pixel grid",
    "weapon": "pixel art isolated medieval weapon blade and haft sprite sheet on dark background, sharp metallic edge, specular steel highlights, dark fantasy RPG pixel art, crisp pixel grid",
    "weapon_behind": "pixel art isolated medieval weapon haft sprite sheet on dark background, dark fantasy RPG pixel art, crisp pixel grid",
    "neck": "pixel art isolated medieval collar and gorget sprite sheet on dark background, dark fantasy RPG pixel art, crisp pixel grid",
    "waist": "pixel art isolated medieval belt and sash sprite sheet on dark background, leather and metal buckle, dark fantasy RPG pixel art, crisp pixel grid",
}

CATEGORY_DEFAULT_DENOISE = {
    "body": 0.40,
    "head": 0.38,
    "eyes": 0.25,
    "beards": 0.38,
    "hair": 0.38,
    "hat": 0.38,
    "torso": 0.40,
    "legs": 0.38,
    "feet": 0.38,
    "shoulders": 0.40,
    "arms": 0.38,
    "cape": 0.38,
    "cape_behind": 0.38,
    "shield": 0.39,
    "shield_behind": 0.38,
    "weapon": 0.36,
    "weapon_behind": 0.36,
    "neck": 0.38,
    "waist": 0.38,
}


def scale2x(img_np: np.ndarray) -> np.ndarray:
    """Exact EPX / Scale2x pixel-art 2x upscaler."""
    h, w, c = img_np.shape
    P = np.pad(img_np, ((1, 1), (1, 1), (0, 0)), mode="edge")
    A = P[:-2, 1:-1]
    B = P[1:-1, 2:]
    C = P[1:-1, :-2]
    D = P[2:, 1:-1]
    E = P[1:-1, 1:-1]

    def eq(x, y):
        return np.all(x == y, axis=-1, keepdims=True)

    c_d = ~eq(C, B) & ~eq(A, D)
    E0 = np.where(eq(C, A) & c_d, A, E)
    E1 = np.where(eq(A, B) & c_d, B, E)
    E2 = np.where(eq(D, C) & c_d, C, E)
    E3 = np.where(eq(B, D) & c_d, D, E)

    out = np.zeros((h * 2, w * 2, c), dtype=img_np.dtype)
    out[0::2, 0::2] = E0
    out[0::2, 1::2] = E1
    out[1::2, 0::2] = E2
    out[1::2, 1::2] = E3
    return out


def compute_universal_head_offsets() -> dict:
    """
    Measures the exact (dx, dy) translation of every (row, col) of the human male
    head across all standard LPC animations relative to walk.png Col 0.
    """
    offsets = {}
    walk_path = SRC_LPC_ROOT / "head" / "heads" / "human" / "male" / "walk.png"
    if not walk_path.exists():
        return offsets
    base_walk = np.array(Image.open(walk_path).convert("RGBA"))
    ref_bboxes = []
    for r in range(4):
        cell = base_walk[r * 64 : (r + 1) * 64, 0:64, 3] > 0
        ys, xs = np.where(cell)
        ref_bboxes.append((int(xs.min()), int(ys.min())))

    for anim_file in (SRC_LPC_ROOT / "head" / "heads" / "human" / "male").glob("*.png"):
        anim = anim_file.stem
        im = np.array(Image.open(anim_file).convert("RGBA"))
        rows = 1 if anim == "hurt" else 4
        cols = im.shape[1] // 64
        anim_table = []
        for r in range(rows):
            ref_r = 2 if anim == "hurt" else r
            rx0, ry0 = ref_bboxes[ref_r]
            row_list = []
            for c in range(cols):
                cell = im[r * 64 : (r + 1) * 64, c * 64 : (c + 1) * 64, 3] > 0
                if not cell.any():
                    row_list.append((0, 0))
                else:
                    ys, xs = np.where(cell)
                    dx = int(xs.min()) - rx0
                    dy = int(ys.min()) - ry0
                    row_list.append((dx, dy))
            anim_table.append(row_list)
        offsets[anim] = anim_table
    return offsets


HEAD_OFFSET_TABLE = compute_universal_head_offsets()


def scale_head_cell_128(
    cell_64: np.ndarray,
    head_scale: float = 0.75,
    dx_64: int = 0,
    dy_64: int = 0,
    row_dir: int = 2,
    pivot_x: int = 64,
    pivot_y: int = 70,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Scales a 64x64 head-anchored frame to 128x128 using Scale2x + `head_scale`
    (default 0.75x) anchored at the universal neck pivot (64, 70).
    Returns (rgba_128, mask_128).
    """
    s2x = scale2x(cell_64)
    a2x = s2x[:, :, 3] > 127
    if not a2x.any():
        return np.zeros((128, 128, 4), dtype=np.uint8), np.zeros((128, 128), dtype=bool)

    new_size = max(1, int(round(128 * head_scale)))
    pil_rgb = Image.fromarray(s2x[:, :, :3], "RGB").resize((new_size, new_size), Image.Resampling.LANCZOS)
    pil_msk = Image.fromarray((a2x.astype(np.uint8) * 255), "L").resize((new_size, new_size), Image.Resampling.NEAREST)

    eff_dy = dy_64 + (1 if row_dir == 0 else 0)
    src_px = pivot_x + dx_64 * 2
    src_py = pivot_y + eff_dy * 2

    scaled_px = int(round(src_px * head_scale))
    scaled_py = int(round(src_py * head_scale))
    paste_x = src_px - scaled_px
    paste_y = src_py - scaled_py

    canvas_rgb = np.zeros((128, 128, 3), dtype=np.uint8)
    canvas_msk = np.zeros((128, 128), dtype=bool)

    rgb_arr = np.array(pil_rgb)
    msk_arr = np.array(pil_msk) > 127

    y0 = max(0, paste_y)
    x0 = max(0, paste_x)
    y1 = min(128, paste_y + new_size)
    x1 = min(128, paste_x + new_size)

    sy0 = y0 - paste_y
    sx0 = x0 - paste_x
    sy1 = sy0 + (y1 - y0)
    sx1 = sx0 + (x1 - x0)

    if y1 > y0 and x1 > x0:
        canvas_rgb[y0:y1, x0:x1] = rgb_arr[sy0:sy1, sx0:sx1]
        canvas_msk[y0:y1, x0:x1] = msk_arr[sy0:sy1, sx0:sx1]

    rgba = np.zeros((128, 128, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.where(canvas_msk[:, :, None], canvas_rgb, 0)
    rgba[:, :, 3] = np.where(canvas_msk, 255, 0)
    return rgba, canvas_msk


def make_slate_1024(rgba_128: np.ndarray, mask_128: np.ndarray) -> Image.Image:
    """Composites a 128x128 RGBA patch onto #141218 dark slate and upscales 8x NEAREST to 1024x1024."""
    canvas = np.full((128, 128, 3), BG_COLOR, dtype=np.uint8)
    canvas = np.where(mask_128[:, :, None], rgba_128[:, :, :3], canvas)
    return Image.fromarray(canvas, "RGB").resize((1024, 1024), Image.Resampling.NEAREST)


def downsample_1024_to_128(img_1024: Image.Image) -> np.ndarray:
    """Box-averages a 1024x1024 Krea2 output back to a crisp 128x128 RGB grid."""
    return np.array(img_1024.convert("RGB").resize((128, 128), Image.Resampling.BOX))


class ComfyClient:
    """Lightweight HTTP client for local ComfyUI server (http://127.0.0.1:8188)."""

    def __init__(self, base_url: str = COMFY_URL):
        self.base_url = base_url.rstrip("/")

    def is_online(self) -> bool:
        try:
            req = urllib.request.Request(f"{self.base_url}/system_stats", method="GET")
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                return resp.status == 200
        except Exception:
            return False

    def interrupt_and_clear(self):
        try:
            req = urllib.request.Request(
                f"{self.base_url}/interrupt",
                data=b"{}",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=3.0).read()
            req2 = urllib.request.Request(
                f"{self.base_url}/queue",
                data=json.dumps({"clear": True}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req2, timeout=3.0).read()
        except Exception:
            pass

    def run_sheet_pass(
        self,
        input_1024_img: Image.Image,
        cache_key: str,
        prompt: str,
        denoise: float = 0.38,
        seed: int = 778899,
        steps: int = 8,
        force: bool = False,
        stop_event: threading.Event | None = None,
    ) -> tuple[Image.Image, Path, Path, bool]:
        """
        Runs a single 1024x1024 isolated paper-doll sheet through ComfyUI Krea2 Turbo,
        or returns the cached output if `cache_key` already exists and `force` is False.
        Returns (output_1024_pil, in_path, out_path, was_cached).
        """
        COMFY_IN_DIR.mkdir(parents=True, exist_ok=True)
        COMFY_OUT_DIR.mkdir(parents=True, exist_ok=True)

        in_path = COMFY_IN_DIR / f"{cache_key}_in.png"
        out_path = COMFY_OUT_DIR / f"{cache_key}_out.png"

        if not in_path.exists() or force:
            input_1024_img.save(in_path)

        if out_path.exists() and not force:
            return Image.open(out_path).convert("RGB"), in_path, out_path, True

        if stop_event and stop_event.is_set():
            raise InterruptedError("Worker stopped before ComfyUI submission.")

        # Upload input image to ComfyUI
        boundary = "----LPCUpgraderBoundary" + str(int(time.time() * 1000))
        with open(in_path, "rb") as f:
            file_bytes = f.read()

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{in_path.name}"\r\n'
            f"Content-Type: image/png\r\n\r\n"
        ).encode("utf-8") + file_bytes + (
            f"\r\n--{boundary}\r\n"
            f'Content-Disposition: form-data; name="overwrite"\r\n\r\n'
            f"true\r\n--{boundary}--\r\n"
        ).encode("utf-8")

        up_req = urllib.request.Request(
            f"{self.base_url}/upload/image",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(up_req, timeout=10.0) as resp:
            up_res = json.loads(resp.read().decode("utf-8"))
        uploaded_name = up_res["name"]

        # Load workflow template and set inputs accurately:
        # Node "5" = CLIPTextEncode (positive prompt), Node "7" = LoadImage
        with open(WORKFLOW_TEMPLATE_PATH, "r", encoding="utf-8") as f:
            wf = json.load(f)

        wf["5"]["inputs"]["text"] = prompt
        wf["7"]["inputs"]["image"] = uploaded_name
        wf["9"]["inputs"]["seed"] = int(seed)
        wf["9"]["inputs"]["steps"] = int(steps)
        wf["9"]["inputs"]["denoise"] = float(denoise)
        wf["11"]["inputs"]["filename_prefix"] = f"lpc128_{cache_key}"

        q_req = urllib.request.Request(
            f"{self.base_url}/prompt",
            data=json.dumps({"prompt": wf}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(q_req, timeout=10.0) as resp:
            q_res = json.loads(resp.read().decode("utf-8"))
        prompt_id = q_res["prompt_id"]

        # Poll /history/{prompt_id}
        start_t = time.time()
        while True:
            if stop_event and stop_event.is_set():
                self.interrupt_and_clear()
                raise InterruptedError("Worker stopped during ComfyUI generation.")
            if time.time() - start_t > 180.0:
                raise TimeoutError(f"ComfyUI timed out on {cache_key}")
            time.sleep(0.35)
            h_req = urllib.request.Request(f"{self.base_url}/history/{prompt_id}", method="GET")
            with urllib.request.urlopen(h_req, timeout=5.0) as resp:
                hist = json.loads(resp.read().decode("utf-8"))
            if prompt_id in hist:
                outputs = hist[prompt_id].get("outputs", {})
                for node_id, node_out in outputs.items():
                    if "images" in node_out and node_out["images"]:
                        img_info = node_out["images"][0]
                        q_params = urllib.parse.urlencode({
                            "filename": img_info["filename"],
                            "subfolder": img_info.get("subfolder", ""),
                            "type": img_info.get("type", "output"),
                        })
                        v_req = urllib.request.Request(f"{self.base_url}/view?{q_params}", method="GET")
                        with urllib.request.urlopen(v_req, timeout=10.0) as v_resp:
                            out_bytes = v_resp.read()
                        with open(out_path, "wb") as out_f:
                            out_f.write(out_bytes)
                        return Image.open(out_path).convert("RGB"), in_path, out_path, False


def build_reference_usage_set() -> set[str]:
    """Finds all LPC asset paths actively referenced in appearance.js, srd.js, and items.json."""
    blobs = []
    for rel in ["src/game/appearance.js", "src/game/srd.js", "src/game/items.json"]:
        p = REPO_ROOT / rel
        if p.exists():
            blobs.append(p.read_text(encoding="utf-8", errors="ignore"))
    combined = "\n".join(blobs)

    all_dirs = sorted(
        set(
            os.path.dirname(os.path.relpath(f, SRC_LPC_ROOT)).replace("\\", "/")
            for f in glob.glob(str(SRC_LPC_ROOT / "**" / "*.png"), recursive=True)
            if not f.endswith("wolfsheet1.png")
        )
    )
    active = set()
    for d in all_dirs:
        parts = d.split("/")
        cat = parts[0]
        sub = "/".join(parts[1:])
        for sfx in ["/male", "/female", "/adult", "/thin", "/fg", "/bg", "/mg", "/default"]:
            if sub.endswith(sfx):
                sub = sub[: -len(sfx)]
        for sfx in ["/male", "/female", "/adult", "/thin", "/fg", "/bg", "/mg"]:
            if sub.endswith(sfx):
                sub = sub[: -len(sfx)]
        if sub in combined or d in combined or cat in ("body", "eyes", "head"):
            active.add(d)
    return active


def analyze_item_directory(item_id: str, active_set: set[str], existing_params: dict | None = None) -> dict:
    """
    Analyzes a single LPC item directory (`public/lpc/<item_id>`) and computes its
    exact pipeline mode, sheet list, completion status in `public/lpc_128/`, and
    exact deduplicated ComfyUI pass count.
    """
    src_dir = SRC_LPC_ROOT / item_id
    dst_dir = DST_LPC_ROOT / item_id
    cat = item_id.split("/")[0]
    is_head = cat in HEAD_CATEGORIES
    is_active = item_id in active_set

    if is_head:
        tier = "tier1_heads"
    elif is_active and cat not in ("neck", "waist"):
        tier = "tier2_core_gear"
    else:
        tier = "tier3_full_catalog"

    png_files = sorted(os.path.basename(f) for f in glob.glob(str(src_dir / "*.png")))
    done_files = [f for f in png_files if (dst_dir / f).exists()]

    # Estimate exact deduplicated ComfyUI passes
    if is_head:
        if cat == "eyes":
            est_passes = 0  # Eyes are 2x6 pixel dots scaled deterministically
        else:
            # Check if 0.75x scaled head item fits in 62x62 (1 pass) or >62px tall (2 passes)
            ref_png = src_dir / ("walk.png" if (src_dir / "walk.png").exists() else png_files[0])
            im = np.array(Image.open(ref_png).convert("RGBA"))
            max_h = 0
            for r in range(min(4, im.shape[0] // 64)):
                a = im[r * 64 : (r + 1) * 64, 0:64, 3] > 0
                if a.any():
                    ys, _ = np.where(a)
                    h = int((ys.max() - ys.min() + 1) * 1.5)
                    if h > max_h:
                        max_h = h
            est_passes = 1 if max_h <= 62 else 2
    else:
        unique_patches = {}
        for fn in png_files:
            anim = os.path.splitext(fn)[0]
            rows = 1 if anim == "hurt" else 4
            im = np.array(Image.open(src_dir / fn).convert("RGBA"))
            fs = max(64, im.shape[0] // rows)
            cols = im.shape[1] // fs
            for r in range(rows):
                for c in range(cols):
                    cell = im[r * fs : (r + 1) * fs, c * fs : (c + 1) * fs]
                    a = cell[:, :, 3] > 0
                    if not a.any():
                        continue
                    ys, xs = np.where(a)
                    crop = cell[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
                    h_key = hashlib.md5(crop.tobytes()).hexdigest()
                    if r == 3:
                        flip_key = hashlib.md5(np.fliplr(crop).tobytes()).hexdigest()
                        if flip_key in unique_patches:
                            continue
                    if h_key not in unique_patches:
                        unique_patches[h_key] = (crop.shape[1] * 2, crop.shape[0] * 2)
        b_2x2 = sum(1 for w, h in unique_patches.values() if w <= 62 and h <= 62)
        b_1x2 = sum(
            1
            for w, h in unique_patches.values()
            if not (w <= 62 and h <= 62) and (w <= 124 and h <= 62)
        )
        b_1x1 = sum(1 for w, h in unique_patches.values() if not (w <= 124 and h <= 62))
        est_passes = max(1, (b_2x2 + 3) // 4 + (b_1x2 + 1) // 2 + b_1x1)

    if len(done_files) == len(png_files) and len(png_files) > 0:
        status = "done"
    elif len(done_files) > 0:
        status = "partial"
    else:
        status = "pending"

    default_params = {
        "denoise": CATEGORY_DEFAULT_DENOISE.get(cat, 0.38),
        "seed": 778899,
        "steps": 8,
        "head_scale": 0.75 if is_head else 1.0,
        "prompt": CATEGORY_PROMPTS.get(cat, CATEGORY_PROMPTS["torso"]),
    }
    if existing_params:
        default_params.update(existing_params)

    return {
        "id": item_id,
        "category": cat,
        "pipeline_mode": "head_static_4dir" if is_head else "animated_packed",
        "tier": tier,
        "active_in_game": is_active,
        "sheets_total": len(png_files),
        "sheets_done": len(done_files),
        "sheets": png_files,
        "done_list": done_files,
        "est_passes": est_passes,
        "status": status,
        "params": default_params,
    }


def migrate_poc_cache():
    """
    Imports existing POC ComfyUI outputs from `scratch/lpc_upscale_poc/comfy_out_4dir`
    so the 4 already-upgraded head items can immediately stamp all 7 of their animation
    sheets (`idle`, `walk`, `slash`, `thrust`, `shoot`, `spellcast`, `hurt`) without
    calling ComfyUI.
    """
    COMFY_OUT_DIR.mkdir(parents=True, exist_ok=True)
    COMFY_IN_DIR.mkdir(parents=True, exist_ok=True)
    poc_out = REPO_ROOT / "scratch" / "lpc_upscale_poc" / "comfy_out_4dir"
    poc_in = REPO_ROOT / "scratch" / "lpc_upscale_poc" / "comfy_in_4dir"
    mapping = {
        "pd_head_4dir": "head__heads__human__male_4dir_0",
        "pd_hair_4dir": "hair__messy1__adult_4dir_0",
        "pd_helm_4dir": "hat__helmet__barbarian__adult_4dir_0",
    }
    for poc_key, prod_key in mapping.items():
        src_o = poc_out / f"{poc_key}_out.png"
        dst_o = COMFY_OUT_DIR / f"{prod_key}_out.png"
        if src_o.exists() and not dst_o.exists():
            shutil.copy2(src_o, dst_o)
        src_i = poc_in / f"{poc_key}.png"
        dst_i = COMFY_IN_DIR / f"{prod_key}_in.png"
        if src_i.exists() and not dst_i.exists():
            shutil.copy2(src_i, dst_i)


def compile_head_static_item(
    item: dict,
    comfy_client: ComfyClient,
    force: bool = False,
    stop_event: threading.Event | None = None,
    progress_cb=None,
) -> list[str]:
    """
    Upgrades all animation sheets for a head-anchored item (`head`, `hair`, `hat`,
    `beards`, `eyes`) using a 4-direction isolated paper-doll sheet + neck-offset stamper.
    """
    item_id = item["id"]
    cat = item["category"]
    params = item["params"]
    head_scale = float(params.get("head_scale", 0.75))
    denoise = float(params.get("denoise", 0.38))
    seed = int(params.get("seed", 778899))
    steps = int(params.get("steps", 8))
    prompt = str(params.get("prompt", CATEGORY_PROMPTS.get(cat, "")))

    src_dir = SRC_LPC_ROOT / item_id
    dst_dir = DST_LPC_ROOT / item_id
    dst_dir.mkdir(parents=True, exist_ok=True)

    # Pick reference 4-row sheet (`walk.png` preferred)
    ref_name = "walk.png" if (src_dir / "walk.png").exists() else item["sheets"][0]
    ref_im = np.array(Image.open(src_dir / ref_name).convert("RGBA"))

    # Measure item's own reference row bboxes on col 0 for fallback delta calculation
    ref_poses_64 = []
    ref_bboxes_64 = []
    for r in range(4):
        r_idx = min(r, (ref_im.shape[0] // 64) - 1)
        cell = ref_im[r_idx * 64 : (r_idx + 1) * 64, 0:64]
        ref_poses_64.append(cell)
        a = cell[:, :, 3] > 0
        if a.any():
            ys, xs = np.where(a)
            ref_bboxes_64.append((int(xs.min()), int(ys.min())))
        else:
            ref_bboxes_64.append((0, 0))

    # Scale the 4 reference poses to 128x128 (Scale2x + 0.75x anchored at (64, 70))
    scaled_poses = []
    scaled_masks = []
    crops = []
    max_w, max_h = 0, 0
    for r in range(4):
        rgba_128, msk_128 = scale_head_cell_128(
            ref_poses_64[r], head_scale=head_scale, dx_64=0, dy_64=0, row_dir=r
        )
        scaled_poses.append(rgba_128)
        scaled_masks.append(msk_128)
        if msk_128.any():
            ys, xs = np.where(msk_128)
            y0, y1 = int(ys.min()), int(ys.max()) + 1
            x0, x1 = int(xs.min()), int(xs.max()) + 1
            crops.append((y0, y1, x0, x1))
            max_w = max(max_w, x1 - x0)
            max_h = max(max_h, y1 - y0)
        else:
            crops.append(None)

    slug = item_id.replace("/", "__")
    upgraded_poses_128 = []

    if cat == "eyes":
        # Eyes are 2x6 pixel dots — keep crisp scaled pixels without diffusion blur
        upgraded_poses_128 = scaled_poses
    elif max_w <= 64 and max_h <= 64:
        # Pack all 4 directions into 1 single 2x2 isolated paper-doll sheet!
        pack_rgba = np.zeros((128, 128, 4), dtype=np.uint8)
        pack_msk = np.zeros((128, 128), dtype=bool)
        quads = [(0, 0), (0, 64), (64, 0), (64, 64)]
        paste_info = []
        for r in range(4):
            if crops[r] is None:
                paste_info.append(None)
                continue
            y0, y1, x0, x1 = crops[r]
            ch, cw = y1 - y0, x1 - x0
            qy, qx = quads[r]
            py = qy + max(0, (64 - ch) // 2)
            px = qx + max(0, (64 - cw) // 2)
            py1 = min(qy + 64, py + ch)
            px1 = min(qx + 64, px + cw)
            sh, sw = py1 - py, px1 - px
            pack_rgba[py:py1, px:px1] = scaled_poses[r][y0 : y0 + sh, x0 : x0 + sw]
            pack_msk[py:py1, px:px1] = scaled_masks[r][y0 : y0 + sh, x0 : x0 + sw]
            paste_info.append((py, px, sh, sw, y0, x0))

        cache_key = f"{slug}_4dir_0"
        if progress_cb:
            progress_cb(item_id, 1, 1, cache_key)
        in_1024 = make_slate_1024(pack_rgba, pack_msk)
        out_1024, _, _, _ = comfy_client.run_sheet_pass(
            in_1024, cache_key, prompt, denoise=denoise, seed=seed, steps=steps, force=force, stop_event=stop_event
        )
        out_128_rgb = downsample_1024_to_128(out_1024)

        for r in range(4):
            pose = np.zeros((128, 128, 4), dtype=np.uint8)
            if paste_info[r] is not None:
                py, px, sh, sw, y0, x0 = paste_info[r]
                msk = scaled_masks[r]
                rgb_canvas = np.copy(scaled_poses[r][:, :, :3])
                rgb_canvas[y0 : y0 + sh, x0 : x0 + sw] = out_128_rgb[py : py + sh, px : px + sw]
                pose[:, :, :3] = np.where(msk[:, :, None], rgb_canvas, 0)
                pose[:, :, 3] = np.where(msk, 255, 0)
            upgraded_poses_128.append(pose)
    else:
        # Tall hair (>64px tall at 0.75x, e.g. floor-length relm_xlong): pack 2 directions per sheet (2 passes)
        for pass_idx, pair in enumerate([(0, 1), (2, 3)]):
            pack_rgba = np.zeros((128, 128, 4), dtype=np.uint8)
            pack_msk = np.zeros((128, 128), dtype=bool)
            halves = [(0, 0), (0, 64)]
            paste_info = []
            for idx, r in enumerate(pair):
                if crops[r] is None:
                    paste_info.append(None)
                    continue
                y0, y1, x0, x1 = crops[r]
                ch, cw = y1 - y0, x1 - x0
                hy, hx = halves[idx]
                py = max(0, (128 - ch) // 2)
                px = hx + max(0, (64 - cw) // 2)
                py1 = min(128, py + ch)
                px1 = min(hx + 64, px + cw)
                sh, sw = py1 - py, px1 - px
                pack_rgba[py:py1, px:px1] = scaled_poses[r][y0 : y0 + sh, x0 : x0 + sw]
                pack_msk[py:py1, px:px1] = scaled_masks[r][y0 : y0 + sh, x0 : x0 + sw]
                paste_info.append((py, px, sh, sw, y0, x0))

            cache_key = f"{slug}_4dir_{pass_idx}"
            if progress_cb:
                progress_cb(item_id, pass_idx + 1, 2, cache_key)
            in_1024 = make_slate_1024(pack_rgba, pack_msk)
            out_1024, _, _, _ = comfy_client.run_sheet_pass(
                in_1024, cache_key, prompt, denoise=denoise, seed=seed, steps=steps, force=force, stop_event=stop_event
            )
            out_128_rgb = downsample_1024_to_128(out_1024)
            for idx, r in enumerate(pair):
                pose = np.zeros((128, 128, 4), dtype=np.uint8)
                if paste_info[idx] is not None:
                    py, px, sh, sw, y0, x0 = paste_info[idx]
                    msk = scaled_masks[r]
                    rgb_canvas = np.copy(scaled_poses[r][:, :, :3])
                    rgb_canvas[y0 : y0 + sh, x0 : x0 + sw] = out_128_rgb[py : py + sh, px : px + sw]
                    pose[:, :, :3] = np.where(msk[:, :, None], rgb_canvas, 0)
                    pose[:, :, 3] = np.where(msk, 255, 0)
                upgraded_poses_128.append(pose)

    # Stamp out all animation sheets for this head-anchored item
    written = []
    for fn in item["sheets"]:
        anim = os.path.splitext(fn)[0]
        src_sheet = np.array(Image.open(src_dir / fn).convert("RGBA"))
        rows = 1 if (anim in ("hurt", "climb") or src_sheet.shape[0] == 64) else 4
        fs = src_sheet.shape[0] // rows
        cols = src_sheet.shape[1] // fs
        out_fs = fs * 2
        out_sheet = np.zeros((rows * out_fs, cols * out_fs, 4), dtype=np.uint8)

        for r in range(rows):
            pose_dir = 2 if (rows == 1 and anim == "hurt") else (0 if (rows == 1 and anim == "climb") else r)
            base_pose = upgraded_poses_128[pose_dir]
            if not (base_pose[:, :, 3] > 0).any():
                continue
            for c in range(cols):
                src_cell = src_sheet[r * fs : (r + 1) * fs, c * fs : (c + 1) * fs]
                if not (src_cell[:, :, 3] > 0).any():
                    continue
                if anim in HEAD_OFFSET_TABLE and r < len(HEAD_OFFSET_TABLE[anim]) and c < len(HEAD_OFFSET_TABLE[anim][r]):
                    dx_64, dy_64 = HEAD_OFFSET_TABLE[anim][r][c]
                else:
                    ys, xs = np.where(src_cell[:, :, 3] > 0)
                    rx0, ry0 = ref_bboxes_64[pose_dir]
                    dx_64 = int(xs.min()) - rx0
                    dy_64 = int(ys.min()) - ry0

                sh_x = dx_64 * 2
                sh_y = dy_64 * 2
                cell_out = np.zeros((128, 128, 4), dtype=np.uint8)
                y0 = max(0, sh_y)
                x0 = max(0, sh_x)
                y1 = min(128, 128 + sh_y)
                x1 = min(128, 128 + sh_x)
                sy0 = max(0, -sh_y)
                sx0 = max(0, -sh_x)
                sy1 = sy0 + (y1 - y0)
                sx1 = sx0 + (x1 - x0)
                if y1 > y0 and x1 > x0:
                    cell_out[y0:y1, x0:x1] = base_pose[sy0:sy1, sx0:sx1]

                pad = (out_fs - 128) // 2
                out_sheet[r * out_fs + pad : r * out_fs + pad + 128, c * out_fs + pad : c * out_fs + pad + 128] = cell_out

        out_file = dst_dir / fn
        Image.fromarray(out_sheet, "RGBA").save(out_file)
        written.append(fn)

    return written


def compile_animated_item(
    item: dict,
    comfy_client: ComfyClient,
    force: bool = False,
    stop_event: threading.Event | None = None,
    progress_cb=None,
) -> list[str]:
    """
    Upgrades all animation sheets for an animated body/equipment/shield/cape/weapon
    item using cross-sheet patch deduplication, Row 3 <-> Row 1 symmetry, and
    bucketed 2x2 / 1x2 / 1x1 isolated paper-doll ComfyUI sheets.
    """
    item_id = item["id"]
    cat = item["category"]
    params = item["params"]
    denoise = float(params.get("denoise", 0.38))
    seed = int(params.get("seed", 778899))
    steps = int(params.get("steps", 8))
    prompt = str(params.get("prompt", CATEGORY_PROMPTS.get(cat, "")))

    src_dir = SRC_LPC_ROOT / item_id
    dst_dir = DST_LPC_ROOT / item_id
    dst_dir.mkdir(parents=True, exist_ok=True)

    # 1. Extract all non-empty Scale2x frame cells and deduplicate patches
    canonical_patches = {}  # patch_key -> {"crop_rgba": np.ndarray, "crop_msk": np.ndarray, "w": int, "h": int}
    cell_records = {}       # (fn, r, c) -> {"patch_key": str, "flip_x": bool, "y0": int, "x0": int, "s2x": np.ndarray}
    sheet_meta = {}         # fn -> (rows, cols, out_fs)

    for fn in item["sheets"]:
        anim = os.path.splitext(fn)[0]
        src_im = np.array(Image.open(src_dir / fn).convert("RGBA"))
        rows = 1 if (anim in ("hurt", "climb") or src_im.shape[0] in (64, 192)) else 4
        fs = src_im.shape[0] // rows
        cols = src_im.shape[1] // fs
        out_fs = fs * 2
        sheet_meta[fn] = (rows, cols, out_fs)

        for r in range(rows):
            for c in range(cols):
                cell_64 = src_im[r * fs : (r + 1) * fs, c * fs : (c + 1) * fs]
                if not (cell_64[:, :, 3] > 0).any():
                    continue
                s2x = scale2x(cell_64)
                msk = s2x[:, :, 3] > 127
                if not msk.any():
                    continue
                ys, xs = np.where(msk)
                y0, y1 = int(ys.min()), int(ys.max()) + 1
                x0, x1 = int(xs.min()), int(xs.max()) + 1
                crop_rgba = s2x[y0:y1, x0:x1]
                crop_msk = msk[y0:y1, x0:x1]

                h_key = hashlib.md5(crop_rgba.tobytes()).hexdigest()
                flip_used = False
                if r == 3:
                    flip_rgba = np.fliplr(crop_rgba)
                    flip_key = hashlib.md5(flip_rgba.tobytes()).hexdigest()
                    if flip_key in canonical_patches:
                        h_key = flip_key
                        flip_used = True

                if h_key not in canonical_patches:
                    canonical_patches[h_key] = {
                        "crop_rgba": crop_rgba,
                        "crop_msk": crop_msk,
                        "w": x1 - x0,
                        "h": y1 - y0,
                    }

                cell_records[(fn, r, c)] = {
                    "patch_key": h_key,
                    "flip_x": flip_used,
                    "y0": y0,
                    "x0": x0,
                    "s2x": s2x,
                    "msk": msk,
                }

    # 2. Bucket canonical patches into 2x2 (<=62x62), 1x2 (<=124x62), and 1x1 (>124x62)
    keys_2x2 = [k for k, v in canonical_patches.items() if v["w"] <= 62 and v["h"] <= 62]
    keys_1x2 = [
        k
        for k, v in canonical_patches.items()
        if not (v["w"] <= 62 and v["h"] <= 62) and (v["w"] <= 124 and v["h"] <= 62)
    ]
    keys_1x1 = [
        k for k, v in canonical_patches.items() if not (v["w"] <= 124 and v["h"] <= 62)
    ]

    batches = []
    for i in range(0, len(keys_2x2), 4):
        batches.append(("2x2", keys_2x2[i : i + 4]))
    for i in range(0, len(keys_1x2), 2):
        batches.append(("1x2", keys_1x2[i : i + 2]))
    for k in keys_1x1:
        batches.append(("1x1", [k]))

    slug = item_id.replace("/", "__")
    upgraded_crops_rgb = {}  # patch_key -> upgraded RGB crop (h, w, 3)
    total_passes = max(1, len(batches))

    for b_idx, (mode, b_keys) in enumerate(batches):
        cache_key = f"{slug}_{mode}_{b_idx}"
        if progress_cb:
            progress_cb(item_id, b_idx + 1, total_passes, cache_key)

        pack_rgba = np.zeros((128, 128, 4), dtype=np.uint8)
        pack_msk = np.zeros((128, 128), dtype=bool)
        placements = []

        if mode == "2x2":
            slots = [(0, 0, 64, 64), (0, 64, 64, 64), (64, 0, 64, 64), (64, 64, 64, 64)]
        elif mode == "1x2":
            slots = [(0, 0, 64, 128), (64, 0, 64, 128)]
        else:
            slots = [(0, 0, 128, 128)]

        for s_idx, pk in enumerate(b_keys):
            p = canonical_patches[pk]
            sy, sx, sh_max, sw_max = slots[s_idx]
            pw, ph = p["w"], p["h"]
            # Center crop inside slot (if crop > 128 on an oversize weapon swoosh, center-window 128x128)
            src_y0 = max(0, (ph - sh_max) // 2)
            src_x0 = max(0, (pw - sw_max) // 2)
            copy_h = min(sh_max, ph - src_y0)
            copy_w = min(sw_max, pw - src_x0)
            dst_y0 = sy + max(0, (sh_max - copy_h) // 2)
            dst_x0 = sx + max(0, (sw_max - copy_w) // 2)

            pack_rgba[dst_y0 : dst_y0 + copy_h, dst_x0 : dst_x0 + copy_w] = p["crop_rgba"][
                src_y0 : src_y0 + copy_h, src_x0 : src_x0 + copy_w
            ]
            pack_msk[dst_y0 : dst_y0 + copy_h, dst_x0 : dst_x0 + copy_w] = p["crop_msk"][
                src_y0 : src_y0 + copy_h, src_x0 : src_x0 + copy_w
            ]
            placements.append((pk, dst_y0, dst_x0, src_y0, src_x0, copy_h, copy_w))

        in_1024 = make_slate_1024(pack_rgba, pack_msk)
        out_1024, _, _, _ = comfy_client.run_sheet_pass(
            in_1024, cache_key, prompt, denoise=denoise, seed=seed, steps=steps, force=force, stop_event=stop_event
        )
        out_128_rgb = downsample_1024_to_128(out_1024)

        for pk, dst_y0, dst_x0, src_y0, src_x0, copy_h, copy_w in placements:
            p = canonical_patches[pk]
            # Initialize with Scale2x RGB so any oversize swoosh tip beyond 128px keeps clean colors
            full_crop_rgb = np.copy(p["crop_rgba"][:, :, :3])
            full_crop_rgb[src_y0 : src_y0 + copy_h, src_x0 : src_x0 + copy_w] = out_128_rgb[
                dst_y0 : dst_y0 + copy_h, dst_x0 : dst_x0 + copy_w
            ]
            upgraded_crops_rgb[pk] = full_crop_rgb

    # 3. Reassemble all animation sheets with exact Scale2x binary alpha masks
    written = []
    for fn in item["sheets"]:
        rows, cols, out_fs = sheet_meta[fn]
        out_sheet = np.zeros((rows * out_fs, cols * out_fs, 4), dtype=np.uint8)
        for r in range(rows):
            for c in range(cols):
                rec = cell_records.get((fn, r, c))
                if not rec:
                    continue
                pk = rec["patch_key"]
                up_rgb = upgraded_crops_rgb[pk]
                if rec["flip_x"]:
                    up_rgb = np.fliplr(up_rgb)
                y0, x0 = rec["y0"], rec["x0"]
                ch, cw, _ = up_rgb.shape
                cell_rgb = np.copy(rec["s2x"][:, :, :3])
                cell_rgb[y0 : y0 + ch, x0 : x0 + cw] = up_rgb
                msk = rec["msk"]

                cell_out = np.zeros((out_fs, out_fs, 4), dtype=np.uint8)
                cell_out[:, :, :3] = np.where(msk[:, :, None], cell_rgb, 0)
                cell_out[:, :, 3] = np.where(msk, 255, 0)
                out_sheet[r * out_fs : (r + 1) * out_fs, c * out_fs : (c + 1) * out_fs] = cell_out

        out_file = dst_dir / fn
        Image.fromarray(out_sheet, "RGBA").save(out_file)
        written.append(fn)

    return written


class PipelineOrchestrator:
    """
    Manages the catalog manifest, job queue, and background worker thread.
    Does NOT run any ComfyUI jobs until `start_worker()` is explicitly called.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.comfy = ComfyClient(COMFY_URL)
        self.catalog = {}  # item_id -> item dict
        self.queue = []    # list of {"id": str, "force": bool}
        self.running = False
        self.stop_event = threading.Event()
        self.worker_thread: threading.Thread | None = None

        self.current_item: str | None = None
        self.current_pass: int = 0
        self.current_total_passes: int = 0
        self.current_cache_key: str | None = None
        self.recent_tiles: list[dict] = []
        self.logs: list[str] = []
        self.avg_pass_sec: float = 1.92

        migrate_poc_cache()
        self.load_or_scan_catalog()

    def log(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        line = f"[{ts}] {msg}"
        with self.lock:
            self.logs.append(line)
            if len(self.logs) > 250:
                self.logs = self.logs[-250:]

    def load_or_scan_catalog(self, force_rescan: bool = False):
        existing_params_map = {}
        if MANIFEST_PATH.exists():
            try:
                data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
                for item in data.get("items", []):
                    existing_params_map[item["id"]] = item.get("params", {})
                if not force_rescan and data.get("items"):
                    with self.lock:
                        self.catalog = {it["id"]: it for it in data["items"]}
                    self.refresh_disk_status()
                    return
            except Exception:
                pass

        self.log("Scanning public/lpc/ catalog (423 directories, 2,694 sprite sheets)...")
        active_set = build_reference_usage_set()
        all_dirs = sorted(
            set(
                os.path.dirname(os.path.relpath(f, SRC_LPC_ROOT)).replace("\\", "/")
                for f in glob.glob(str(SRC_LPC_ROOT / "**" / "*.png"), recursive=True)
                if not f.endswith("wolfsheet1.png")
            )
        )
        new_cat = {}
        for d in all_dirs:
            new_cat[d] = analyze_item_directory(d, active_set, existing_params_map.get(d))

        with self.lock:
            self.catalog = new_cat
        self.save_manifest()
        self.log(f"Catalog scan complete: {len(new_cat)} items indexed.")

    def refresh_disk_status(self):
        """Fast check of `public/lpc_128/` to update done/partial/pending statuses."""
        queued_ids = {q["id"] for q in self.queue}
        with self.lock:
            for item_id, item in self.catalog.items():
                dst_dir = DST_LPC_ROOT / item_id
                done_files = [f for f in item["sheets"] if (dst_dir / f).exists()]
                item["done_list"] = done_files
                item["sheets_done"] = len(done_files)
                if item_id == self.current_item and self.running:
                    item["status"] = "running"
                elif item_id in queued_ids:
                    item["status"] = "queued"
                elif len(done_files) == item["sheets_total"] and item["sheets_total"] > 0:
                    item["status"] = "done"
                elif len(done_files) > 0:
                    item["status"] = "partial"
                else:
                    item["status"] = "pending"

    def save_manifest(self):
        with self.lock:
            payload = {
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "items": list(self.catalog.values()),
            }
        MANIFEST_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def get_summary_stats(self) -> dict:
        self.refresh_disk_status()
        with self.lock:
            items = list(self.catalog.values())
            total_items = len(items)
            done_items = sum(1 for i in items if i["status"] == "done")
            partial_items = sum(1 for i in items if i["status"] == "partial")
            queued_items = len(self.queue)

            total_sheets = sum(i["sheets_total"] for i in items)
            done_sheets = sum(i["sheets_done"] for i in items)

            total_passes = sum(i["est_passes"] for i in items)
            done_passes = sum(
                i["est_passes"]
                for i in items
                if i["status"] == "done"
            )
            rem_passes = max(0, total_passes - done_passes)
            queue_passes = sum(
                self.catalog[q["id"]]["est_passes"]
                for q in self.queue
                if q["id"] in self.catalog
            )

            tiers = {}
            for t_key in ("tier1_heads", "tier2_core_gear", "tier3_full_catalog"):
                t_items = [i for i in items if i["tier"] == t_key]
                tiers[t_key] = {
                    "items_total": len(t_items),
                    "items_done": sum(1 for i in t_items if i["status"] == "done"),
                    "sheets_total": sum(i["sheets_total"] for i in t_items),
                    "sheets_done": sum(i["sheets_done"] for i in t_items),
                    "passes_total": sum(i["est_passes"] for i in t_items),
                    "passes_rem": sum(i["est_passes"] for i in t_items if i["status"] != "done"),
                }

            return {
                "running": self.running,
                "comfy_online": self.comfy.is_online(),
                "current_item": self.current_item,
                "current_pass": self.current_pass,
                "current_total_passes": self.current_total_passes,
                "current_cache_key": self.current_cache_key,
                "items_total": total_items,
                "items_done": done_items,
                "items_partial": partial_items,
                "items_queued": queued_items,
                "sheets_total": total_sheets,
                "sheets_done": done_sheets,
                "passes_total": total_passes,
                "passes_done": done_passes,
                "passes_remaining": rem_passes,
                "queue_passes": queue_passes,
                "avg_pass_sec": round(self.avg_pass_sec, 2),
                "eta_queue_sec": int(queue_passes * self.avg_pass_sec),
                "eta_all_sec": int(rem_passes * self.avg_pass_sec),
                "tiers": tiers,
                "queue": list(self.queue),
                "recent_tiles": list(self.recent_tiles[-12:]),
                "logs": list(self.logs[-60:]),
            }

    def enqueue(self, item_ids: list[str], force: bool = False, prioritize: bool = False) -> int:
        added = 0
        with self.lock:
            existing = {q["id"] for q in self.queue}
            new_entries = []
            for iid in item_ids:
                if iid not in self.catalog:
                    continue
                if not force and self.catalog[iid]["status"] == "done":
                    continue
                if iid in existing:
                    if force:
                        for q in self.queue:
                            if q["id"] == iid:
                                q["force"] = True
                    continue
                new_entries.append({"id": iid, "force": bool(force)})
                existing.add(iid)
                added += 1
            if prioritize:
                self.queue = new_entries + self.queue
            else:
                self.queue.extend(new_entries)
        self.refresh_disk_status()
        self.log(f"Queued {added} item(s) (queue size: {len(self.queue)}).")
        return added

    def remove_from_queue(self, item_ids: list[str]):
        rm_set = set(item_ids)
        with self.lock:
            self.queue = [q for q in self.queue if q["id"] not in rm_set]
        self.refresh_disk_status()

    def clear_queue(self):
        with self.lock:
            self.queue.clear()
        self.refresh_disk_status()
        self.log("Queue cleared.")

    def update_params(self, item_ids: list[str], new_params: dict):
        with self.lock:
            for iid in item_ids:
                if iid in self.catalog:
                    for k in ("denoise", "seed", "steps", "head_scale", "prompt"):
                        if k in new_params and new_params[k] is not None:
                            self.catalog[iid]["params"][k] = new_params[k]
        self.save_manifest()
        self.log(f"Updated generation parameters for {len(item_ids)} item(s).")

    def start_worker(self):
        with self.lock:
            if self.running:
                return
            self.stop_event.clear()
            self.running = True
            self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
            self.worker_thread.start()
        self.log("Queue worker started.")

    def stop_worker(self, interrupt_comfy: bool = True):
        self.stop_event.set()
        if interrupt_comfy:
            self.comfy.interrupt_and_clear()
        self.log("Stop signal sent to worker.")

    def _on_pass_progress(self, item_id: str, pass_idx: int, pass_total: int, cache_key: str):
        with self.lock:
            self.current_item = item_id
            self.current_pass = pass_idx
            self.current_total_passes = pass_total
            self.current_cache_key = cache_key
            tile_entry = {
                "item_id": item_id,
                "cache_key": cache_key,
                "in_url": f"/cache/comfy_in/{cache_key}_in.png",
                "out_url": f"/cache/comfy_out/{cache_key}_out.png",
                "ts": int(time.time()),
            }
            self.recent_tiles = [t for t in self.recent_tiles if t["cache_key"] != cache_key] + [tile_entry]

    def _worker_loop(self):
        try:
            while not self.stop_event.is_set():
                with self.lock:
                    if not self.queue:
                        break
                    job = self.queue.pop(0)
                    item_id = job["id"]
                    force = job.get("force", False)
                    item = self.catalog.get(item_id)
                    if not item:
                        continue
                    self.current_item = item_id
                    self.current_pass = 0
                    self.current_total_passes = item["est_passes"]
                    item["status"] = "running"

                self.log(f"Upgrading {item_id} ({item['pipeline_mode']}, {item['est_passes']} pass(es))...")
                t0 = time.time()
                try:
                    if item["pipeline_mode"] == "head_static_4dir":
                        written = compile_head_static_item(
                            item, self.comfy, force=force, stop_event=self.stop_event, progress_cb=self._on_pass_progress
                        )
                    else:
                        written = compile_animated_item(
                            item, self.comfy, force=force, stop_event=self.stop_event, progress_cb=self._on_pass_progress
                        )
                    dt = time.time() - t0
                    if item["est_passes"] > 0 and dt > 0.5:
                        pass_t = dt / item["est_passes"]
                        self.avg_pass_sec = 0.8 * self.avg_pass_sec + 0.2 * pass_t
                    self.log(f"Completed {item_id}: {len(written)} sheets written in {dt:.1f}s.")
                except InterruptedError:
                    self.log(f"Paused/Interrupted on {item_id}; returning item to front of queue.")
                    with self.lock:
                        self.queue.insert(0, job)
                    break
                except Exception as e:
                    self.log(f"ERROR on {item_id}: {e}")
                    with self.lock:
                        item["status"] = "error"
                self.refresh_disk_status()
                self.save_manifest()
        finally:
            with self.lock:
                self.running = False
                self.current_item = None
                self.current_pass = 0
                self.current_total_passes = 0
            self.refresh_disk_status()
            self.save_manifest()
            self.log("Queue worker idle.")

