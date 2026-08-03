# Pixel Art Monster Sprite Generation Workflow

## Overview

This workflow generates high-quality, pixel-perfect game sprites from DCSS (Dungeon Crawl Stone Soup) monster sprites. The process combines AI image generation with grid-aligned pixel art refinement to produce clean, game-ready assets at 64x64 resolution with transparent backgrounds.

**Output:** 10 variations per monster, 64x64 pixels, black background (manual background removal needed)

## Pipeline Architecture

The workflow consists of three stages:

### Stage 1: Sprite Upscaling (Python + PIL)
- Takes the original 32x32 DCSS sprite
- Upscales to 512x512 using nearest-neighbor interpolation
- Preserves sharp pixel edges (critical for retro aesthetic)
- Input: `G:\ClaudesFolder\dungeon-crawlers\Sprites\Dungeon Crawl Stone Soup Full\monster\<name>.png`
- Output: Temporary file in ComfyUI input directory

### Stage 2: AI Styling via img2img (ComfyUI)
- Uses FT_PixelArt_img2img.json workflow
- Model: Illustrious with pixel_art_style_by_skormino LoRA
- Settings:
  - **Denoise: 0.5** (50% style transfer strength)
  - **Steps: 28**
  - **CFG: 5.0**
  - **Sampler: euler_ancestral**
  - **Scheduler: normal**
- Generates 10 variations with different seeds (666000 + i)
- Prompt: Requests pixel art style with light background (though currently generates black)
- Output: 512x512 raw images in `ComfyUI\output\goblin_raw\`

### Stage 3: Grid Alignment & Downscaling (Pixel Perfect)
- Uses the pixel-art-assets-generator skill's pixelfixer
- Command: `fix_pixel_art.py INPUT OUTPUT --size 64 --no-bg-remove`
- Processes the 512x512 raw images to:
  - Detect and align the pixel grid
  - Downscale to 64x64 while preserving grid alignment
  - Skip background removal (handled manually later)
- Output: 64x64 grid-perfect sprites

## File Structure

```
G:\ClaudesFolder\dungeon-crawlers\Sprites\dnd_enemies\
├── <monster_name>/
│   ├── raw/                    # Original 512x512 ComfyUI outputs
│   │   └── <monster>_##_raw.png
│   └── final_64/               # Final 64x64 game sprites
│       └── <monster>_##.png
```

Example for goblins:
```
goblin/
├── raw/
│   ├── goblin_01_raw.png
│   ├── goblin_02_raw.png
│   └── ... (10 total)
└── final_64/
    ├── goblin_01.png
    ├── goblin_02.png
    └── ... (10 total)
```

## Key Parameters & Settings

### Upscaling
- **Method:** Nearest-neighbor (PIL Image.Resampling.NEAREST)
- **Target:** 512x512
- **Reason:** Preserves sharp pixel edges, essential for pixel art

### Image Generation (img2img)
- **Denoise:** 0.5
  - Controls how much the output differs from input
  - 0.0 = pixel-perfect copy of input
  - 1.0 = fully regenerated from scratch
  - 0.5 balances composition preservation with stylization
  
- **Seed Sequence:** 666000 + variation_number (1-10)
  - Different seeds = different styling variations
  - Reproducible if seed is known

- **Prompt Template:**
  ```
  pixpix, 8-bit, pixel_art, masterpiece, best quality, 
  <MONSTER_DESCRIPTION>, isolated character sprite, 
  white or light gray background, NOT black background, 
  black pixel outline
  ```
  - Replace `<MONSTER_DESCRIPTION>` with specific creature details
  - Example: "green goblin creature, small humanoid, pointy ears, detailed pixel art"

### Pixelfixer
- **Size:** 64 (target long-edge dimension)
- **No Background Removal:** `--no-bg-remove` flag
- **Purpose:** Grid detection, alignment, and downscaling while maintaining pixel-perfect quality

## Workflow Scripts

**Primary script (single monster):** 
```
C:\Users\fello\AppData\Local\Temp\claude\G--ClaudesFolder\9d610141-f80f-4d26-a23f-430222134f6a\scratchpad\generate_monster.py
```

**Usage:**
```bash
cd "C:\Users\fello\AppData\Local\Temp\claude\G--ClaudesFolder\9d610141-f80f-4d26-a23f-430222134f6a\scratchpad"
python generate_monster.py <name> <sprite_path> <description>
```

**Example:**
```bash
python generate_monster.py adder "G:\ClaudesFolder\dungeon-crawlers\Sprites\Dungeon Crawl Stone Soup Full\monster\animals\adder.png" "small venomous serpent with scaled green-brown hide, forked tongue, fanged mouth, coiled striking posture"
```

**Batch script (all five at once):**
```
C:\Users\fello\AppData\Local\Temp\claude\G--ClaudesFolder\9d610141-f80f-4d26-a23f-430222134f6a\scratchpad\run_first_five.py
```

**Legacy script (goblin):**
```
C:\Users\fello\AppData\Local\Temp\claude\G--ClaudesFolder\9d610141-f80f-4d26-a23f-430222134f6a\scratchpad\upscale_ft_pipeline.py
``` 
(Kept for reference; use generate_monster.py for new creatures)

### How to Generate a Monster

**Step 1: Find DCSS sprite**
```bash
ls "G:\ClaudesFolder\dungeon-crawlers\Sprites\Dungeon Crawl Stone Soup Full\monster\"
```
Common locations:
- Basic creatures: `monster/` (e.g., `goblin.png`, `orc.png`)
- Animals: `monster/animals/` (e.g., `adder.png`, `wolf.png`)
- Dragons: `monster/dragons/` (e.g., `reddragon.png`, `Whitedragon.png`)
- Elements: `monster/nonliving/` (e.g., `air_elemental.png`, `fire_elemental.png`)

**Step 2: Get visual description**
From `MONSTER_LIST_WITH_DESCRIPTIONS.md`, copy the one-line description

**Step 3: Run generation**
```bash
python generate_monster.py "monster_name" "C:\path\to\sprite.png" "visual description here"
```

**Step 4: Wait for completion**
- ~10-15 minutes per creature (10 variations)
- Check output: `G:\ClaudesFolder\dungeon-crawlers\Sprites\dnd_enemies\<monster_name>\final_64\`

### Prompt Template

The script automatically uses:
```
pixpix, 8-bit, pixel_art, masterpiece, best quality, <DESCRIPTION>, isolated character sprite, no ground, white or light gray background, NOT black background, black pixel outline
```

**Note:** Despite explicit "light background" request, the model generates black backgrounds (model bias). Manual removal needed.

### Critical Implementation Details

1. **Input directory path** (must use relative path):
   ```python
   INPUT_DIR = os.path.join(OUT_BASE, "..", "input")
   # This resolves to: G:\Data\Packages\ComfyUI\input\
   ```

2. **LoadImage node setup** (in workflow before submission):
   ```python
   wf["11"]["inputs"]["image"] = "monster_name_512.png"  # Filename only, no path
   ```

3. **SaveImage node setup** (for proper output organization):
   ```python
   wf["9"]["inputs"]["filename_prefix"] = "monster_name_raw/var"
   ```

4. **Seed variation** (ensures 10 unique outputs):
   ```python
   wf["3"]["inputs"]["seed"] = 666000 + i  # i from 1-10
   ```

## Critical Dependencies

### Software
- **Python:** `G:\Data\Packages\ComfyUI\venv\Scripts\python.exe` (has numpy, scipy, opencv-python, Pillow)
- **ComfyUI:** Running at `http://192.168.2.19:8188` (started by Zenu)
- **Pixel Perfect Tool:** `C:\Users\fello\.claude\skills\pixel-art-assets-generator\scripts\fix_pixel_art.py`

### Workflows
- **FT_PixelArt_img2img.json:** `G:\ClaudesFolder\data\custom_workflows\FT_PixelArt_img2img.json`
  - Do NOT use older FT_PixelArt.json (Illustrious-based, drifts into creatures)
  - Do NOT use DC_IconPixelArt_Z.json (Z-Image Turbo, designed for icons not creatures)

### Source Sprites
- Located: `G:\ClaudesFolder\dungeon-crawlers\Sprites\Dungeon Crawl Stone Soup Full\monster\`
- Available: goblin, hobgoblin, orc, skeleton, zombie, ghoul, troll, etc.

## Known Limitations & Workarounds

### Issue 1: Model generates black backgrounds despite prompt
**Status:** Known issue, not fixed (model bias toward dark backgrounds)
**Workaround:** Manual background removal after generation (see below)

### Issue 2: Aggressive background removal removes black outlines
**Status:** Attempted fix removed (looked horrible)
**Workaround:** Skip automatic background removal, do it manually
**Note:** ComfyUI background removal is too aggressive for pixel art outlines; always use `--no-bg-remove` flag

### Issue 3: ComfyUI LoadImage node file paths
**Status:** FIXED in v1.1
**Root cause:** Workflow LoadImage node requires files in ComfyUI input directory (not output)
**Solution:** Save upscaled sprites to `G:\Data\Packages\ComfyUI\input\` before submitting workflow
**Path formula:** `os.path.join(OUT_BASE, "..", "input")` works reliably

### Issue 4: Workflow JSON image placeholder
**Status:** FIXED in v1.1
**Root cause:** Had invalid `"IMAGE_PATH"` placeholder; LoadImage expects actual filename
**Solution:** Use relative path from workflow, e.g. `"monster_name_512.png"` in LoadImage node
**Critical:** Always set in script before submitting: `wf["11"]["inputs"]["image"] = filename`

## Post-Processing: Manual Background Removal

Generated sprites have black backgrounds that need manual removal.

### In Photoshop/GIMP:
1. Open the 64x64 sprite
2. Select by Color tool → click black background
3. Delete to transparency
4. Export as PNG with transparency

### In Python (if needed):
```python
from PIL import Image

img = Image.open("goblin_01.png")
img = img.convert("RGBA")

# Make black transparent (threshold: RGB values < 30)
data = img.getdata()
new_data = []
for pixel in data:
    r, g, b = pixel[:3]
    if r < 30 and g < 30 and b < 30:
        new_data.append((r, g, b, 0))  # Transparent
    else:
        new_data.append(pixel)

img.putdata(new_data)
img.save("goblin_01_transparent.png")
```

## Troubleshooting

### ComfyUI connection error (HTTP 400)
- Check ComfyUI is running: `http://192.168.2.19:8188`
- Check workflow JSON is valid
- Verify all node references exist in the workflow

### File locking errors during move/copy
- ComfyUI may still have file open
- Solution: Use copy instead of move, add small delay (`time.sleep(0.5)`)

### Pixelfixer grid detection too coarse
- Use `--detail N` flag to request finer grid (N=2,3,4)
- Or use `--force-step N` for exact pixel cell size
- Inspect with `--json` flag to see detected grid

### Sprite looks over-simplified
- Increase denoise to 0.6-0.7 for more styling
- Check source sprite quality (very small sprites lose detail)

## Quality Checklist

Before shipping a batch:

- [ ] All 10 variations are present
- [ ] Each file is exactly 64x64 pixels
- [ ] Files are organized in correct folder structure
- [ ] Sprites have good variety (different expressions, colors)
- [ ] Grid alignment looks clean (no waviness)
- [ ] Black background is uniform (ready for removal)

## Future Improvements

1. **Better prompt engineering** to generate light backgrounds instead of black
2. **AI background removal** that preserves outlines (try rembg or similar)
3. **Batch processing** for multiple monsters in one run
4. **Parameter tuning UI** to test denoise/CFG before full generation
5. **Post-processing pipeline** for automatic final cleanup

## Related Skills & Tools

- **pixel-art-assets-generator:** Contains pixelfixer and pixelfix_ui
  - Docs: `C:\Users\fello\.claude\skills\pixel-art-assets-generator\README.md`
  - Interactive UI: `python scripts/pixelfix_ui/server.py --port 8765`

## Version History

- **v1.1** (2026-07-30, Current): Fixed workflow and created parameterized script
  - Fixed FT_PixelArt_img2img.json (removed invalid "IMAGE_PATH" placeholder)
  - Discovered input directory path formula: `os.path.join(OUT_BASE, "..", "input")`
  - Created generate_monster.py for flexible single-monster generation
  - Created run_first_five.py for batch processing
  - Tested successfully with Adder, Gold Dragon, Red Dragon, White Dragon, Air Elemental
  - Upscale to 512x512 (nearest-neighbor)
  - FT pixel art img2img at 50% denoise
  - Pixelfix downscale to 64x64
  - Manual background removal required (ComfyUI generates black backgrounds)

- **v1.0** (2026-07-30): Initial workflow with 64x64 output
  - Upscale to 512x512 (nearest-neighbor)
  - FT pixel art img2img at 50% denoise (test run on goblins)
  - Pixelfix downscale to 64x64
  - Manual background removal required
