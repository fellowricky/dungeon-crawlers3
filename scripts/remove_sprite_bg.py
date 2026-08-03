#!/usr/bin/env python3
"""
Sprite Background Removal & Outline Tool (Refined)
--------------------------------------------------
Automates background removal for pixel art sprites while preserving
and applying a strong 1-pixel solid black outline around the sprite.

Fixes patchiness on dark sprites (shadow dragons, dark insects, demons)
by performing strict border-connected flood fill without internal hole deletion.
"""

import argparse
import glob
import os
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation


def remove_background_and_outline(img: Image.Image, bg_tol: float = 12.0, mode: str = 'outer', remove_holes: bool = False) -> tuple[Image.Image, dict]:
    """
    Processes a single PIL Image: removes background and adds a 1px solid black outline.
    Returns (processed_PIL_image, metadata_dict).
    """
    arr = np.array(img.convert('RGBA'))
    h, w, _ = arr.shape
    rgb = arr[:, :, :3]

    # Sample perimeter pixels (top, bottom, left, right borders)
    border_px = np.vstack([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    bg_color = np.median(border_px, axis=0)

    # Calculate max component difference from background color
    diff = np.max(np.abs(rgb.astype(float) - bg_color.astype(float)), axis=-1)

    # 4-connected flood fill starting ONLY from image perimeter pixels
    bg_mask = np.zeros((h, w), dtype=bool)
    stack = []
    for y in range(h):
        for x in range(w):
            if y == 0 or y == h - 1 or x == 0 or x == w - 1:
                if diff[y, x] <= bg_tol:
                    bg_mask[y, x] = True
                    stack.append((y, x))

    struct_4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    while stack:
        cy, cx = stack.pop()
        for dy, dx in struct_4:
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and not bg_mask[ny, nx]:
                if diff[ny, nx] <= bg_tol:
                    bg_mask[ny, nx] = True
                    stack.append((ny, nx))

    # Optional hole removal (disabled by default to protect dark sprite bodies)
    if remove_holes:
        enclosed = (diff <= bg_tol * 0.5) & ~bg_mask
        bg_mask = bg_mask | enclosed

    sprite_mask = ~bg_mask
    s_struct = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)

    res = np.zeros((h, w, 4), dtype=np.uint8)

    if mode == 'none':
        res[sprite_mask] = arr[sprite_mask]
        res[sprite_mask, 3] = 255
        out_px_count = 0
    elif mode == 'outer':
        dilated = binary_dilation(sprite_mask, structure=s_struct)
        outer_outline = dilated & ~sprite_mask
        res[sprite_mask] = arr[sprite_mask]
        res[sprite_mask, 3] = 255
        res[outer_outline] = [0, 0, 0, 255]
        out_px_count = int(outer_outline.sum())

    stats = {
        'bg_color': bg_color.astype(int).tolist(),
        'bg_pixels': int(bg_mask.sum()),
        'sprite_pixels': int(sprite_mask.sum()),
        'outline_pixels': out_px_count,
    }

    return Image.fromarray(res, mode='RGBA'), stats


def process_file(filepath: str, outpath: str = None, bg_tol: float = 12.0, mode: str = 'outer', remove_holes: bool = False, overwrite: bool = False, dry_run: bool = False) -> bool:
    try:
        img = Image.open(filepath)
        arr = np.array(img)
        # Skip if already transparent and user didn't force overwrite
        if arr.ndim == 3 and arr.shape[2] == 4 and arr[:, :, 3].min() < 255 and not overwrite:
            print(f"Skipping (already transparent): {os.path.basename(filepath)}")
            return False

        res_img, stats = remove_background_and_outline(img, bg_tol=bg_tol, mode=mode, remove_holes=remove_holes)

        if not outpath:
            if overwrite:
                outpath = filepath
            else:
                base, ext = os.path.splitext(filepath)
                outpath = f"{base}_clean.png"

        if not dry_run:
            os.makedirs(os.path.dirname(outpath) or '.', exist_ok=True)
            res_img.save(outpath, 'PNG')
            print(f"Processed: {os.path.basename(filepath)} -> {os.path.basename(outpath)} | BG: {stats['bg_color']} | Outline Px: {stats['outline_pixels']}")
        else:
            print(f"[Dry Run] {os.path.basename(filepath)} | BG: {stats['bg_color']} | Sprite Px: {stats['sprite_pixels']} | Outline Px: {stats['outline_pixels']}")

        return True
    except Exception as e:
        print(f"Error processing {filepath}: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Automates sprite background removal with a 1px solid black outline.")
    parser.add_argument('-i', '--input', required=True, help="Input PNG file or directory containing PNG files.")
    parser.add_argument('-o', '--output', help="Output PNG file or output directory.")
    parser.add_argument('--overwrite', action='store_true', help="Overwrite input file(s) directly.")
    parser.add_argument('--bg-tolerance', type=float, default=12.0, help="Background color matching tolerance (default: 12.0).")
    parser.add_argument('--mode', choices=['outer', 'none'], default='outer', help="Outline mode: outer (default) or none.")
    parser.add_argument('--remove-holes', action='store_true', help="Remove enclosed background holes (disabled by default to protect dark sprites).")
    parser.add_argument('--dry-run', action='store_true', help="Perform dry run without saving files.")

    args = parser.parse_args()

    if os.path.isdir(args.input):
        files = sorted(glob.glob(os.path.join(args.input, '*.png')))
        print(f"Found {len(files)} PNG file(s) in {args.input}")
        count = 0
        for f in files:
            out_file = None
            if args.output:
                os.makedirs(args.output, exist_ok=True)
                out_file = os.path.join(args.output, os.path.basename(f))
            if process_file(f, outpath=out_file, bg_tol=args.bg_tolerance, mode=args.mode, remove_holes=args.remove_holes, overwrite=args.overwrite, dry_run=args.dry_run):
                count += 1
        print(f"Finished processing {count} file(s).")
    elif os.path.isfile(args.input):
        process_file(args.input, outpath=args.output, bg_tol=args.bg_tolerance, mode=args.mode, remove_holes=args.remove_holes, overwrite=args.overwrite, dry_run=args.dry_run)
    else:
        print(f"Error: Input path '{args.input}' does not exist.", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
