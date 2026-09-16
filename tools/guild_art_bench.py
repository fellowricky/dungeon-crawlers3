"""
GUILD BUILDING ART BENCH — race several ComfyUI recipes on the same subject.

The point is to pick ONE recipe for the whole 14-building set. Everything the
recipes share (subject text, camera-angle clause, palette, seed, target pixel
size, the fixer pass) is held identical here so the only variable is the model
and LoRA stack.

  python tools/guild_art_bench.py --subject tavern --seeds 2
  python tools/guild_art_bench.py --recipes spriteshaper,illu_pixelcore
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

COMFY = 'http://192.168.2.19:8188'
VENV_PY = r'G:\Data\Packages\ComfyUI\venv\Scripts\python.exe'
COMFY_OUT = r'G:\Data\Packages\ComfyUI\output'
FIXER = r'C:\Users\fello\.claude\skills\pixel-art-assets-generator\scripts\fix_pixel_art.py'
Z_WORKFLOW = r'G:\ClaudesFolder\data\custom_workflows\DC_GuildBuilding_Z.json'

# Placeholder mode: skip the Retro-Diffusion pixel fixer entirely and keep the
# raw render at full resolution. The fixer (grid snap + palette quantise) is a
# finishing step for FINAL assets; running it on throwaway placeholders just
# costs time and throws away resolution we may want later.
USE_FIXER = False

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REVIEW = os.path.join(REPO, 'scratch', 'guild_art')
# Sprite pixel density, in art pixels per world unit.
#
# Set to the LPC hero density, not the ground's. HeroSprite draws a 64px frame
# at 1.125 world units = 56.9 px/unit, and heroes stand directly in front of
# these buildings — if a building is coarser than the hero, every doorway reads
# as too small for the person walking through it. A first pass at ~18 px/unit
# (whatever the model's raw grid happened to give) put buildings at 0.3x the
# hero and looked exactly that wrong.
#
# The DCSS ground is 32 px/unit and stays coarser than both; ground being less
# detailed than the things standing on it is normal and reads fine.
PX_PER_UNIT = 56

# ---------------------------------------------------------------------------
# Shared prompt pieces. Identical for every recipe — this is the control.
# ---------------------------------------------------------------------------

# Camera. The first bench showed the model draws roughly a 15-20 degree
# elevation when simply told "35 degrees", which is far too low for our scene
# camera (guild_layout.js CAM.pitch = 0.62 rad = 35.5 deg). Abstract angle
# wording does not land, so this instead states the COMPOSITION the angle
# implies, which models follow much more reliably.
ANGLE = ("high three-quarter overhead view looking down at the building, "
         "the pitched roof seen from above and filling the upper two thirds of the sprite, "
         "the front wall visible below it in the lower third, "
         "front facade square to the viewer, symmetrical, "
         "orthographic projection, flat projection, no perspective distortion, no vanishing point")

PALETTE = ("consistent warm midday sunlight from the upper left, "
           "muted earthy palette: sandstone plaster walls, terracotta clay roof tiles, "
           "dark oak timber beams, grey fieldstone footings")

DUSK_PALETTE = ("muted dark fantasy palette, weathered grey-brown timber framing, "
                "damp mossy stone, aged plaster in warm stone-grey, dark slate roof, "
                "desaturated but clearly readable MID-TONES, not black, not silhouette, "
                "soft overcast daylight from the upper left keeping every surface legible, "
                "warm amber lantern light in the windows, "
                "grounded earthy colours that sit against mossy green grass and packed brown earth")

DARK_PALETTE = ("dark fantasy palette, deep desaturated colours, "
                "weathered blackened timber framing, damp grey stone, "
                "soot-stained and moss-streaked plaster, dark slate roof, "
                "cold blue-grey shadows, warm amber lantern light glowing out of the windows, "
                "heavy contrast, grim and moody")

CLEAN = ("single building only, complete whole building, centered, "
         "isolated entirely on a perfectly pure solid white background, "
         "no ground, no grass, no terrain, no shadow, no scene, no sky, no people, "
         "hard pixel edges, sharp cutout silhouette, no anti-aliasing, no soft blending")

NEG = ("interior, cutaway, floor plan, blueprint, top-down map, straight-on side elevation, "
       "eye level view, low angle, isometric diamond, rotated 45 degrees, extreme perspective, "
       "multiple buildings, village, town square, street, row of houses, "
       "creature, character, humanoid, person, animal, monster, face, body, "
       "scene, background scenery, landscape, sky, clouds, trees, bushes, fence, road, "
       "text, watermark, signature, blurry, jpeg artifacts, border, frame, "
       "photorealistic, 3d render, smooth shading, soft edges, anti-aliasing, gradient blending, "
       "glow, halo, blur, feathered edge, drop shadow, vignette, cropped, cut off")

SUBJECTS = {
    # `w` is the building's width in world units, straight out of guild_layout.js.
    # Describe the STRUCTURE literally — the skill's hard-won lesson is that
    # thematic labels ("a building for the crypt") drift, shape descriptions don't.
    'tavern': dict(w=11, text=(
        "medieval fantasy tavern inn, ground floor of rough grey fieldstone masonry "
        "with visible mortar joints, upper floor of heavy dark oak timber framing "
        "with dark wattle infill between the beams, jettied first floor overhanging the street, "
        "steep wood-shingle roof, a squat rough stone chimney with smoke, "
        "a wide iron-banded oak door, small mullioned windows glowing warm amber, "
        "a big carved wooden signboard hanging from a wrought iron bracket, "
        "ale barrels and a bench stacked beside the door, an iron lantern by the doorway"
    )),
    # Deliberately minimal: says WHAT the building is and nothing about how it
    # is built. The style study needs the construction to come from STYLES; when
    # the subject also specified materials it simply overrode every style
    # direction and all five variants came out identical.
    'tavern_min': dict(w=11, text=(
        "medieval fantasy tavern inn, two storeys, "
        "a large carved wooden signboard hanging from a wrought iron bracket beside the door, "
        "ale barrels and a bench outside the door, an iron lantern at the doorway, "
        "small windows glowing warm amber, a smoking chimney"
    )),
    'blacksmith': dict(w=9, text=(
        "medieval fantasy blacksmith forge workshop, single storey stone building, "
        "low slate roof, a tall stone chimney, a wide open work bay with a glowing forge "
        "and an anvil, heavy timber shutters"
    )),
    'living_quarters': dict(w=10, text=(
        "medieval fantasy guild dormitory hall, two storeys, long tiled roof, "
        "sandstone plaster walls with timber corner posts, two rows of small shuttered windows, "
        "a stone chimney, a plain arched door"
    )),
    'enchanter': dict(w=7, text=(
        "medieval fantasy wizard tower, tall slender round stone spire, conical slate roof, "
        "narrow arched windows glowing pale blue spiralling up the shaft, "
        "a small arched door at its base"
    )),
    'crypt': dict(w=8, text=(
        "medieval fantasy stone crypt mausoleum, low and heavy, flat slab roof with a carved cornice, "
        "two stout pillars flanking a dark iron door, weathered grey stone blocks"
    )),
    'academy': dict(w=9, text=(
        "medieval fantasy scholars library hall, two storeys, tiled roof, "
        "tall arched leaded windows, sandstone walls, a wide stone stair up to double doors"
    )),
    'infirmary': dict(w=8, text=(
        "medieval fantasy infirmary hospice building, single storey, long tiled roof, "
        "whitewashed plaster walls, wide shuttered windows, a painted healers cross above the door"
    )),
    'armory': dict(w=8, text=(
        "medieval fantasy armoury storehouse, squat fortified stone building, "
        "low slate roof, iron banded double doors, narrow slit windows, buttressed walls"
    )),
    'war_room': dict(w=9, text=(
        "medieval fantasy war council hall, single storey stone building, tiled roof, "
        "heavy timber doors, hanging war banners either side of the entrance, crenellated parapet"
    )),
    'cartographer': dict(w=9, text=(
        "medieval fantasy cartographers guild house, two storeys, tiled roof, "
        "a large bay window, timber framing, a weathervane on the ridge"
    )),
    'apothecary': dict(w=8, text=(
        "medieval fantasy apothecary shop, narrow two storey building, steep tiled roof, "
        "a bow window of small glass panes, drying herbs hanging under the eaves, a low green door"
    )),
    'merchant': dict(w=8, text=(
        "medieval fantasy market stall shopfront, open timber frame with a striped awning, "
        "a wooden counter piled with crates and barrels, small tiled roof above"
    )),
}

# ---------------------------------------------------------------------------
# Recipes. `pixelart,` prefix is the common trigger for all these LoRAs/models.
# ---------------------------------------------------------------------------

RECIPES = {
    'z_image': dict(kind='zimage'),

    'spriteshaper': dict(kind='sdxl', ckpt='pixelArtDiffusionXL_spriteShaper.safetensors',
                         lora=None, steps=28, cfg=6.0, size=1024,
                         sampler='dpmpp_2m', sched='karras'),

    'hyperpixel': dict(kind='sdxl', ckpt='hyperpixel_v10.safetensors',
                       lora=None, steps=28, cfg=6.0, size=1024,
                       sampler='dpmpp_2m', sched='karras'),

    'illu_pixelcore': dict(kind='sdxl', ckpt='bismuthIllustrious_v80.safetensors',
                           lora='new_pixel_core-ILL.safetensors', lora_str=1.0,
                           steps=28, cfg=5.0, size=1024,
                           sampler='dpmpp_2m', sched='karras'),

    'illu_skormino3': dict(kind='sdxl', ckpt='bismuthIllustrious_v80.safetensors',
                           lora='Pixel-Art Style v3 (illustrious by Skormino).safetensors', lora_str=1.0,
                           steps=28, cfg=5.0, size=1024,
                           sampler='dpmpp_2m', sched='karras'),
}


# Steeper camera. v0's wording still produced eye-level buildings from the SDXL
# models, so v2 states the downward look far more forcefully.
ANGLE_STEEP = ("seen from high above at a steep downward angle, looking down onto the roof, "
               "the pitched roof seen from above and dominating the upper two thirds of the sprite, "
               "only a short strip of the front wall visible beneath the eaves, "
               "front facade square to the viewer, symmetrical, "
               "orthographic projection, flat projection, no perspective distortion")

# SDXL weights early tokens heavily and largely ignored a plain "isolated on a
# white background" clause buried mid-prompt — every SDXL recipe in bench 1 drew
# sky, trees and ground anyway. These variants front-load and weight it.
ISO = ("(plain solid pure white background:1.6), (no background scenery:1.5), "
       "(isolated cutout game asset:1.4), single sprite on blank canvas, ")

NEG_ISO = (", (background:1.5), (sky:1.5), (clouds:1.4), (trees:1.5), "
           # At 2048 the model starts composing a SCENE: a grass shelf, a path
           # and a retaining wall under the building. In the compound that would
           # float as a slab of turf, since the 3D ground is already there. These
           # need heavier weight than the rest of the isolation terms.
           "(grass:1.7), (ground:1.7), (lawn:1.6), (soil:1.5), (terrain:1.6), "
           "(garden:1.5), (path:1.6), (walkway:1.5), (steps up to the door:1.4), "
           "(retaining wall:1.5), (terrace:1.4), (hillside:1.4), "
           "scenery, landscape, environment, diorama, base, plinth, pedestal, "
           "street, cobblestones")


# spriteshaper draws isometric (corner-on) buildings by default — it is clearly
# trained on isometric asset packs, and the plain "isometric diamond" negative
# from bench 1/2 did not shift it. v3 weights front-on hard in the positive AND
# names every synonym for corner-on in the negative.
FRONT = ("(front view:1.5), (orthographic front elevation:1.45), "
         "(perfectly symmetrical front facade facing the viewer:1.4), ")

NEG_DARK = ", (pitch black:1.4), (silhouette:1.4), (underexposed:1.3), (night:1.3), crushed blacks, unreadable shadows"

NEG_FRONT = (", (isometric:1.7), (isometric view:1.7), (isometric projection:1.6), "
             "(corner view:1.5), (viewed from the corner:1.5), (three quarter side view:1.4), "
             "(rotated 45 degrees:1.5), (turned to the side:1.4), (side wall visible:1.3), "
             "(perspective:1.3), (diagonal:1.3), sprite sheet, multiple views, character sheet")


# --- material & era study -------------------------------------------------
# The first pass put "sandstone plaster walls" / "aged plaster" in the palette,
# and every building came out with the same dark-tan rendered walls: closer to
# an 1800s townhouse than a medieval fantasy guild. Plaster/stucco is the
# culprit, so every direction below is explicitly stone + timber and names
# plaster in the negative.

NEG_PLASTER = (", (plaster:1.6), (stucco:1.6), (render:1.4), (smooth painted wall:1.5), "
               "(flat tan wall:1.5), (adobe:1.4), (victorian:1.5), (georgian townhouse:1.5), "
               "(19th century:1.5), (colonial:1.4), (brick terrace:1.4), (modern:1.4)")

LIGHT = ("soft overcast daylight from the upper left keeping every surface legible, "
         "warm amber lantern light in the windows, "
         "desaturated readable MID-TONES, not black, not silhouette")

STYLES = {
    # rough masonry base, heavy exposed frame above — the default fantasy read
    'stone': ("built from rough grey fieldstone and heavy dark oak timber, "
              "chunky irregular stone blocks with deep mortar lines, "
              "thick exposed timber beams and braces, wood shingle roof, "
              "NO plaster, NO smooth rendered walls, weathered and mossy"),
    # northern longhouse: timber-dominant, carved, turf roof
    'norse': ("northern longhouse construction, massive carved oak posts and planked walls, "
              "dragon-carved gable ends, mossy turf and shingle roof, low stone footing course, "
              "NO plaster, heavy dark stained wood, iron strapping"),
    # crooked storybook: leaning frame, jettied floors
    'crooked': ("crooked leaning storybook construction, warped dark timber frame, "
                "two jettied upper floors each overhanging the one below, "
                "uneven slate and shingle roof at odd angles, rough stone base, "
                "NO plaster, dark stained wood with stone infill"),
    # fortified: thick masonry, arrow-slit windows, iron
    'fortified': ("fortified stone construction, thick coursed ashlar masonry walls, "
                  "small deep-set windows, iron banded oak door, buttressed corners, "
                  "heavy slate roof, NO plaster, NO timber framing above, all stone"),
    # dark wood dominant with stone infill panels, the inverse of half-timber
    'timber': ("dominated by blackened heavy timber, close-studded oak framing with "
               "dark stone infill panels between the studs, oak shingle roof, "
               "rough stone plinth at the base, NO plaster, NO white panels"),
}

# --- reference study: high-angle JRPG town ---------------------------------
# Target reference is a town square seen from a HIGH overhead angle (~60 deg),
# roofs dominant, facades compressed beneath the eaves, dense prop detail
# (awnings, flower boxes, stalls, barrels), stone-and-timber construction,
# muted palette with warm accents.
#
# Note the angle is considerably steeper than the compound's current camera
# (CAM.pitch 0.62 rad = 35.5 deg). Matching this art means raising CAM.pitch.

ANGLE_HIGH = ("high-angle overhead view looking down on the building from above, "
              "steep downward camera about 60 degrees, "
              "the rooftop is the largest part of the image and is seen fully from above, "
              "the front wall is compressed into a short band beneath the eaves, "
              "top-down JRPG town map view, flat orthographic projection, "
              "facade square to the viewer, symmetrical, no vanishing point")

DETAIL = ("richly detailed, striped cloth awning over the shopfront, "
          "window flower boxes and potted plants, climbing ivy, "
          "wooden crates barrels and sacks stacked outside, hanging lanterns, "
          "a carved hanging signboard, cobblestone doorstep")

REF_PALETTE = ("muted desaturated palette with warm accents, "
               "grey-green slate and wood-shingle roofs, "
               "warm sandy-grey cut stone masonry, dark brown timber beams, "
               "terracotta and cream awning stripes, soft green foliage, "
               "warm amber light in the windows, gentle overcast daylight, "
               "readable mid-tones, high detail 16-bit SNES JRPG town tileset art")

VARIANTS = {
    # bench 1 baseline
    'v0': lambda t: f"pixelart, pixel art sprite of a single {t}, retro 16-bit SNES JRPG town building asset, {ANGLE}, {PALETTE}, crisp pixel-perfect lines, clean hard edges, strong readable silhouette, limited palette, {CLEAN}",
    # front-loaded + weighted isolation
    'v1': lambda t: f"{ISO}pixelart, pixel art sprite of a single {t}, retro 16-bit SNES JRPG town building asset, {ANGLE}, {PALETTE}, crisp pixel-perfect lines, clean hard edges, strong readable silhouette, limited palette, {CLEAN}",
    # isolation + much steeper camera
    'v2': lambda t: f"{ISO}pixelart, pixel art sprite of a single {t}, retro 16-bit SNES JRPG town building asset, {ANGLE_STEEP}, {PALETTE}, crisp pixel-perfect lines, clean hard edges, strong readable silhouette, limited palette, {CLEAN}",
    # Angle attempt N: stop using game-asset language for the camera and use
    # architectural drawing language instead, plus a named game whose buildings
    # ARE front-on. Every game-asset phrasing so far has pulled toward the
    # isometric asset packs these models are saturated with.
    'ref_flat': lambda t: (
        "(architectural front elevation:1.6), (flat facade view:1.5), "
        "(both side walls completely hidden:1.5), (zero side wall visible:1.4), "
        "(the building faces the camera dead on like a stage flat:1.4), "
        f"{ISO}pixelart, detailed pixel art sprite of a single {t}, "
        "in the style of a Stardew Valley town building sprite, "
        "seen from slightly above so the roof shows, but the facade is perfectly square to the camera, "
        f"{STYLES['stone']}, {DETAIL}, {REF_PALETTE}, "
        f"crisp pixel-perfect lines, clean hard edges, limited palette, {CLEAN}"),

    # aiming at the high-angle reference
    'ref_a': lambda t: (f"{FRONT}{ISO}pixelart, detailed pixel art sprite of a single {t}, "
                        f"{ANGLE_HIGH}, {STYLES['stone']}, {DETAIL}, {REF_PALETTE}, "
                        f"crisp pixel-perfect lines, clean hard edges, limited palette, {CLEAN}"),
    # same but roof emphasis pushed harder still
    'ref_b': lambda t: (f"{FRONT}{ISO}pixelart, detailed pixel art sprite of a single {t}, "
                        f"(seen from directly above at a steep angle:1.5), (large rooftop filling most of the sprite:1.4), "
                        f"{ANGLE_HIGH}, {STYLES['stone']}, {DETAIL}, {REF_PALETTE}, "
                        f"crisp pixel-perfect lines, clean hard edges, limited palette, {CLEAN}"),
    # detail-forward, softer angle wording — tests whether the heavy weights hurt
    'ref_c': lambda t: (f"{ISO}pixelart, detailed pixel art sprite of a single {t}, "
                        f"{ANGLE_HIGH}, {STYLES['stone']}, {DETAIL}, {REF_PALETTE}, "
                        f"crisp pixel-perfect lines, clean hard edges, limited palette, {CLEAN}"),

    **{f'st_{k}': (lambda v: (lambda t:
        f"{FRONT}{ISO}pixelart, pixel art sprite of a single {t}, "
        f"dark fantasy medieval 16-bit RPG town building asset, {ANGLE_STEEP}, "
        f"{v}, {LIGHT}, "
        f"crisp pixel-perfect lines, clean hard edges, strong readable silhouette, "
        f"limited palette, {CLEAN}"))(v) for k, v in STYLES.items()},

    # Production variant: dark fantasy, but pitched to sit on the compound's
    # mossy-green / packed-earth ground rather than going near-black.
    'zdusk': lambda t: f"{FRONT}{ISO}pixelart, pixel art sprite of a single {t}, "
                       f"dark fantasy 16-bit RPG town building asset, {ANGLE_STEEP}, {DUSK_PALETTE}, "
                       f"crisp pixel-perfect lines, clean hard edges, strong readable silhouette, "
                       f"limited palette, {CLEAN}",
    # first dark pass — kept for reference, came out too black against the ground
    'zdark': lambda t: f"{FRONT}{ISO}pixelart, pixel art sprite of a single {t}, "
                       f"dark fantasy 16-bit RPG town building asset, {ANGLE_STEEP}, {DARK_PALETTE}, "
                       f"crisp pixel-perfect lines, clean hard edges, strong readable silhouette, "
                       f"limited palette, {CLEAN}",
    # isolation + steep camera + hard front-on lock
    'v3': lambda t: f"{FRONT}{ISO}pixelart, pixel art sprite of a single {t}, retro 16-bit SNES JRPG town building asset, {ANGLE_STEEP}, {PALETTE}, crisp pixel-perfect lines, clean hard edges, strong readable silhouette, limited palette, {CLEAN}",
}


def positive(subject_text, variant='v0'):
    return VARIANTS[variant](subject_text)


def sdxl_graph(r, pos, neg, seed, prefix):
    g = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": r['ckpt']}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": r['size'], "height": r['size'], "batch_size": 1}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
        "8": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["7", 0]}},
    }
    model_src, clip_src = ["1", 0], ["1", 1]
    if r.get('lora'):
        g["2"] = {"class_type": "LoraLoader",
                  "inputs": {"lora_name": r['lora'],
                             "strength_model": r.get('lora_str', 1.0),
                             "strength_clip": r.get('lora_str', 1.0),
                             "model": ["1", 0], "clip": ["1", 1]}}
        model_src, clip_src = ["2", 0], ["2", 1]
    g["3"] = {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": clip_src}}
    g["4"] = {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": clip_src}}
    g["6"] = {"class_type": "KSampler",
              "inputs": {"seed": seed, "steps": r['steps'], "cfg": r['cfg'],
                         "sampler_name": r['sampler'], "scheduler": r['sched'], "denoise": 1,
                         "model": model_src, "positive": ["3", 0], "negative": ["4", 0],
                         "latent_image": ["5", 0]}}
    return g


def zimage_graph(pos, neg, seed, prefix):
    with open(Z_WORKFLOW, 'r', encoding='utf-8') as f:
        wf = json.load(f)
    wf['6']['inputs']['text'] = pos
    wf['106']['inputs']['text'] = neg
    wf['3']['inputs']['seed'] = seed
    wf['9']['inputs']['filename_prefix'] = prefix
    return wf


def queue(g):
    req = urllib.request.Request(f'{COMFY}/prompt',
                                 data=json.dumps({'prompt': g}).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(req).read().decode())['prompt_id']


def wait_idle(timeout=1800):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            q = json.loads(urllib.request.urlopen(f'{COMFY}/queue', timeout=10).read().decode())
            if not q.get('queue_running') and not q.get('queue_pending'):
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def outputs_for(pid):
    h = json.loads(urllib.request.urlopen(f'{COMFY}/history/{pid}', timeout=20).read().decode())
    out = []
    for node in h.get(pid, {}).get('outputs', {}).values():
        for img in node.get('images', []):
            out.append(os.path.join(COMFY_OUT, img.get('subfolder', ''), img['filename']))
    return out


def precrop(raw):
    """Crop the raw render down to the subject before the fixer sees it.

    Without this the fixer scales the whole 768/1024 canvas to the target size,
    and since the building only occupies part of it the sprite lands well under
    the requested pixel width (bench 1 asked for 352 and got 176-260). Cropping
    to the non-white bounding box first makes the requested size the size you
    actually get.
    """
    from PIL import Image, ImageChops
    im = Image.open(raw).convert('RGB')
    bg = Image.new('RGB', im.size, (255, 255, 255))
    # add_modifier 40: treat near-white as background too, JPEG-ish noise aside
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 28 else 0)
    bb = diff.getbbox()
    if not bb:
        return raw
    pad = 6
    bb = (max(0, bb[0] - pad), max(0, bb[1] - pad),
          min(im.width, bb[2] + pad), min(im.height, bb[3] + pad))
    cropped = os.path.join(REVIEW, '_precrop_' + os.path.basename(raw))
    im.crop(bb).save(cropped)
    return cropped


def keyout(path, tol=42):
    """Remove ONLY background that is connected to the image border.

    The fixer's own remove_background takes the median corner colour and deletes
    every pixel within a colour distance of it, anywhere in the image. That is
    fine for a dark icon on white, and catastrophic for a building with pale
    plaster walls: it ate ~26% of the tavern's interior, leaving timber and roof
    floating with holes where the walls should be. The defect is invisible on a
    dark OR light review background, because a hole simply shows whatever is
    behind it.

    Flood-filling inward from the border instead means an enclosed wall panel
    survives no matter how close its colour is to the background. Run AFTER the
    fixer, on the small crisp image, where hard 0/255 alpha is what pixel art
    wants anyway.
    """
    from PIL import Image
    import numpy as np
    from scipy import ndimage

    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)

    corners = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]])
    bg = np.median(corners, axis=0)
    near_bg = (np.abs(a - bg).sum(axis=2) < tol)

    lbl, n = ndimage.label(near_bg)
    if n:
        border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
        border.discard(0)
        outside = np.isin(lbl, list(border)) if border else np.zeros_like(near_bg)
    else:
        outside = np.zeros_like(near_bg)

    rgba = np.dstack([np.asarray(im), np.where(outside, 0, 255).astype(np.uint8)])
    Image.fromarray(rgba, 'RGBA').save(path)
    return float(outside.mean())


def despeckle(path, min_frac=0.0012):
    """Drop opaque islands that are not part of the building.

    z_image leaves a scatter of stray pixels around the silhouette after the
    fixer. They are invisible against white, obvious against magenta, and would
    render as floating dirt in-game. Anything not connected to the main body and
    smaller than min_frac of the sprite goes.
    """
    from PIL import Image
    import numpy as np
    from scipy import ndimage

    im = Image.open(path).convert('RGBA')
    arr = np.asarray(im).copy()
    opaque = arr[:, :, 3] > 0
    lbl, n = ndimage.label(opaque)
    if n <= 1:
        return 0
    sizes = ndimage.sum(opaque, lbl, range(1, n + 1))
    biggest = int(np.argmax(sizes)) + 1
    # Threshold relative to the BUILDING, not to the canvas. An absolute
    # fraction of image area let a single stray speck survive on a 2048 render,
    # and because the alpha crop runs afterwards that one speck stretched the
    # sprite's bounding box to nearly twice the building's size. Anything under
    # 2% of the main mass is not part of the building.
    keep_min = max(12, min_frac * opaque.size, 0.02 * sizes[biggest - 1])
    drop = [i + 1 for i, sz in enumerate(sizes) if sz < keep_min and (i + 1) != biggest]
    if not drop:
        return 0
    arr[np.isin(lbl, drop), 3] = 0
    Image.fromarray(arr, 'RGBA').save(path)
    return len(drop)


def quantise(path, colours=64):
    """Reduce to a limited palette.

    The fixer snaps the GRID but not the palette, so a native-resolution sprite
    still arrives with thousands of near-identical colours. Real pixel art uses
    few. Quantising the opaque pixels tightens the look and makes the sprites
    compress far better, without touching the alpha cut.
    """
    from PIL import Image
    import numpy as np
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)
    alpha = a[:, :, 3]
    rgb = Image.fromarray(a[:, :, :3], 'RGB')
    q = rgb.quantize(colors=colours, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB')
    out = np.dstack([np.asarray(q), alpha])
    Image.fromarray(out, 'RGBA').save(path)


def defringe(path, lum_thresh=225, passes=3):
    """Strip the pale halo left along the silhouette after keying.

    Flood-fill keying is a hard in/out test, so pixels that are a BLEND of white
    background and subject — every anti-aliased edge pixel — fall on the opaque
    side and survive as a near-white rim. Invisible against white, obvious
    against anything else, and the pixel-fixer makes it far worse: block
    averaging turns a 1px rim into a solid cell-sized white border.

    Only pixels on the silhouette edge are considered, so white detail INSIDE
    the sprite is untouched. Repeated a few times because the halo is often 2-3
    px deep.

    Must run BEFORE the pixel fixer.
    """
    from PIL import Image
    import numpy as np
    from scipy import ndimage
    Image.MAX_IMAGE_PIXELS = None

    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).copy()
    removed = 0
    for _ in range(passes):
        opaque = a[:, :, 3] > 0
        edge = opaque & ~ndimage.binary_erosion(opaque, np.ones((3, 3), bool))
        kill = edge & (a[:, :, :3].min(axis=2) > lum_thresh)
        if not kill.any():
            break
        a[kill, 3] = 0
        removed += int(kill.sum())
    if removed:
        Image.fromarray(a, 'RGBA').save(path)
    return removed


def alpha_report(path):
    """Transparency INSIDE the silhouette — i.e. actual holes.

    The first version sampled a fixed central box, which on a full-canvas render
    mostly measured empty sky and reported 50% "holes" for a perfectly intact
    building. Fill the silhouette and compare: only gaps enclosed by the subject
    count.
    """
    from PIL import Image
    import numpy as np
    from scipy import ndimage
    a = np.asarray(Image.open(path).convert('RGBA'))[:, :, 3]
    opaque = a > 0
    if not opaque.any():
        return 100.0
    filled = ndimage.binary_fill_holes(opaque)
    enclosed = int(filled.sum())
    return 0.0 if not enclosed else 100.0 * (filled & ~opaque).sum() / enclosed


def fix_placeholder(raw, out):
    """Full-resolution placeholder: precrop, key the background, despeckle.

    No grid snapping and no palette quantise — those are for final art. The
    keying still has to happen, because the sprite needs real transparency to
    stand in the scene at all.
    """
    import shutil
    raw = precrop(raw)
    shutil.copyfile(raw, out)
    keyout(out)
    despeckle(out, min_frac=0.0004)   # looser: islands are bigger at 2048
    from PIL import Image
    im = Image.open(out).convert('RGBA')
    bb = im.split()[3].getbbox()
    if bb:
        im.crop(bb).save(out)
    return True


def fix(raw, out, target=None):
    if not USE_FIXER:
        return fix_placeholder(raw, out)
    """Snap to the model's OWN pixel grid — never to a requested size.

    This was the single worst bug in the pipeline. Asking the fixer for
    `--size 352` (from the 32-px-per-world-unit rule) upscaled ~2.75x past the
    grid the model actually drew: the fixer reports a native grid of about
    128x126 with 8px cells, so 352 is pure interpolation. The result had 35,099
    unique colours and 93% single-pixel runs — a smooth illustration wearing a
    pixel-art costume, complete with the smeary edge artifacts that come with
    resampling.

    Letting the fixer use its detected grid yields real pixel art. The sprite's
    WORLD size is then set from the layout, not from its pixel count, which
    decouples art resolution from footprint — the right split anyway.
    """
    raw = precrop(raw)

    # Pass 1: let the fixer report the grid the model actually drew.
    probe = subprocess.run([VENV_PY, FIXER, raw, out, '--no-bg-remove', '--json'],
                           capture_output=True, text=True)
    detail = 1
    if probe.returncode == 0 and target:
        try:
            cols = json.loads(probe.stdout).get('cols') or 0
            if cols:
                # How many times finer than the detected grid we must go to hit
                # the density target. This is NOT upscaling: a finer cell keeps
                # more of the detail already present in the large raw render.
                # Capped at 6 so we never ask for more than the source holds.
                detail = max(1, min(6, round(target / cols)))
        except Exception:
            pass

    # Pass 2: reconstruct at that grid (skipped when pass 1 already fits).
    if detail > 1:
        r = subprocess.run([VENV_PY, FIXER, raw, out, '--no-bg-remove',
                            '--detail', str(detail)],
                           capture_output=True, text=True)
    else:
        r = probe
    if r.returncode != 0:
        print('    fixer failed:', r.stderr.strip()[:200])
        return False
    keyout(out)
    despeckle(out)
    quantise(out)
    from PIL import Image
    im = Image.open(out).convert('RGBA')
    bb = im.split()[3].getbbox()
    if bb:
        im.crop(bb).save(out)
    return True


def sheet(entries, path):
    """Each candidate over MAGENTA and over mid grey.

    Magenta is not decoration. Reviewing on dark and light bands hid a bug where
    the pale walls had been keyed out entirely: a hole shows whatever is behind
    it, so it read as shadow on the dark band and as plaster on the light one.
    A colour that cannot occur in the art makes missing pixels unmissable.
    """
    from PIL import Image, ImageDraw
    if not entries:
        return
    ims = [(lbl, Image.open(p).convert('RGBA')) for lbl, p in entries]
    cw = max(i.width for _, i in ims) + 20
    ch = max(i.height for _, i in ims) + 20
    out = Image.new('RGB', (cw * len(ims), ch * 2 + 24), (30, 30, 36))
    d = ImageDraw.Draw(out)
    for i, (lbl, im) in enumerate(ims):
        for row, bg in ((0, (255, 0, 255, 255)), (1, (128, 128, 134, 255))):
            panel = Image.new('RGBA', (cw, ch), bg)
            panel.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
            out.paste(panel.convert('RGB'), (i * cw, row * ch))
        d.text((i * cw + 6, ch * 2 + 6), lbl, fill=(235, 235, 245))
    out.save(path)
    print('sheet ->', path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--subject', default='tavern')
    ap.add_argument('--seeds', type=int, default=2)
    ap.add_argument('--recipes', default=','.join(RECIPES))
    ap.add_argument('--seed-base', type=int, default=730000)
    ap.add_argument('--variants', default='v0',
                    help='comma-separated prompt variants: ' + ','.join(VARIANTS))
    args = ap.parse_args()

    spec = SUBJECTS[args.subject]
    target = spec['w'] * PX_PER_UNIT
    os.makedirs(REVIEW, exist_ok=True)

    names = [r.strip() for r in args.recipes.split(',') if r.strip()]
    variants = [v.strip() for v in args.variants.split(',') if v.strip()]
    jobs = []
    for name in names:
      r = RECIPES[name]
      for variant in variants:
        pos = positive(spec['text'], variant)
        neg = NEG + (NEG_ISO if variant != 'v0' else '')                   + (NEG_FRONT if variant in ('v3', 'zdark', 'zdusk') or variant.startswith(('st_', 'ref_')) else '')                   + (NEG_DARK if variant == 'zdusk' or variant.startswith(('st_', 'ref_')) else '')                   + (NEG_PLASTER if variant.startswith('st_') else '')
        for i in range(args.seeds):
            seed = args.seed_base + i
            tag = f'{name}.{variant}'
            prefix = f'guild/bench_{args.subject}_{name}_{variant}_{seed}'
            g = zimage_graph(pos, neg, seed, prefix) if r['kind'] == 'zimage' \
                else sdxl_graph(r, pos, neg, seed, prefix)
            try:
                pid = queue(g)
            except urllib.error.HTTPError as e:
                print(f'  {tag}/{seed}: QUEUE REJECTED {e.read().decode()[:300]}')
                continue
            jobs.append((pid, tag, seed))
            print(f'queued {tag} seed={seed}')

    print(f'\nwaiting on {len(jobs)} render(s)...')
    wait_idle()

    entries = []
    for pid, name, seed in jobs:
        raws = outputs_for(pid)
        if not raws:
            print(f'  {name}/{seed}: no output')
            continue
        out = os.path.join(REVIEW, f'bench_{args.subject}_{name}_{seed}.png')
        if not fix(raws[0], out, target):
            continue
        from PIL import Image
        w, h = Image.open(out).size
        print(f'  {name}/{seed}: {w}x{h}')
        entries.append((f'{name} {seed} {w}x{h}', out))

    sheet(entries, os.path.join(REVIEW, f'_bench_{args.subject}.png'))


if __name__ == '__main__':
    main()
