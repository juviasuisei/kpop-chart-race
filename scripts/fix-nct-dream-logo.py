#!/usr/bin/env python3
"""
Convert the NCT Dream logo: make green and blue pixels transparent,
keep everything else (white, black, etc.) as-is.
"""

import base64
import io
import re
import sys
from PIL import Image
import numpy as np

SVG_PATH = "public/assets/logos/nct_dream.svg"

# Step 1: Read the SVG and extract the base64 PNG data
with open(SVG_PATH, "r") as f:
    svg_content = f.read()

match = re.search(r'href="data:image/png;base64,([^"]+)"', svg_content)
if not match:
    print("ERROR: Could not find embedded PNG data in SVG")
    sys.exit(1)

b64_data = match.group(1)
png_bytes = base64.b64decode(b64_data)

# Step 2: Open the image
img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
pixels = np.array(img)

print(f"Image size: {img.size}")

# Step 3: Make green, blue, and teal/cyan pixels transparent
# Green: G channel is dominant over R
is_green = (
    (pixels[:,:,1].astype(int) > pixels[:,:,0].astype(int) + 20) &
    (pixels[:,:,1].astype(int) > pixels[:,:,2].astype(int) + 20) &
    (pixels[:,:,3] > 0)
)

# Blue: B channel is dominant over R
is_blue = (
    (pixels[:,:,2].astype(int) > pixels[:,:,0].astype(int) + 20) &
    (pixels[:,:,2].astype(int) > pixels[:,:,1].astype(int) + 20) &
    (pixels[:,:,3] > 0)
)

# Teal/cyan: both G and B high, R low
is_teal = (
    (pixels[:,:,1].astype(int) > pixels[:,:,0].astype(int) + 20) &
    (pixels[:,:,2].astype(int) > pixels[:,:,0].astype(int) + 20) &
    (pixels[:,:,3] > 0)
)

to_clear = is_green | is_blue | is_teal

print(f"Green pixels: {np.sum(is_green)}")
print(f"Blue pixels: {np.sum(is_blue)}")
print(f"Teal/cyan pixels: {np.sum(is_teal)}")
print(f"Total pixels made transparent: {np.sum(to_clear)}")

pixels[to_clear, 3] = 0

# Step 4: Save back
result_img = Image.fromarray(pixels)

buf = io.BytesIO()
result_img.save(buf, format="PNG", optimize=True)
new_png_bytes = buf.getvalue()
new_b64 = base64.b64encode(new_png_bytes).decode("ascii")

print(f"\nOriginal PNG size: {len(png_bytes)} bytes")
print(f"New PNG size: {len(new_png_bytes)} bytes")

# Step 5: Write as a clean SVG
w, h = img.size
new_svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><image width="{w}" height="{h}" href="data:image/png;base64,{new_b64}"/></svg>\n'

with open(SVG_PATH, "w") as f:
    f.write(new_svg)

print(f"\nWrote updated SVG to {SVG_PATH}")
print("Done!")
