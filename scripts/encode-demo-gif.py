"""Encodes frames from scripts/record-demo.mjs into a looping GIF. Requires Pillow and ffmpeg.

Usage: python scripts/encode-demo-gif.py [frames-folder] [output.gif]

Frames stay at their captured size: rescaling adds anti-aliased colours and roughly
triples the file. One global palette, no dithering and rectangle diffs keep the
static UI cheap; scrolling frames dominate the size.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageChops

frames = sys.argv[1] if len(sys.argv) > 1 else 'artifacts/demo-frames'
out = sys.argv[2] if len(sys.argv) > 2 else 'media/bayes-in-your-browser-demo.gif'
timeline = json.load(open(os.path.join(frames, 'timeline.json')))

# Merge identical consecutive frames into one longer frame.
merged, prev = [], None
for f in timeline:
    im = Image.open(os.path.join(frames, f['file'])).convert('RGB')
    if prev is not None and ImageChops.difference(im, prev).getbbox() is None:
        merged[-1]['ms'] += f['ms']
        continue
    merged.append(dict(f))
    prev = im

# GIF delays are centiseconds; carry the rounding error forward.
lines, err = [], 0
for f in merged:
    ms = f['ms'] + err
    cs = max(2, round(ms / 10))
    err = ms - cs * 10
    path = os.path.abspath(os.path.join(frames, f['file'])).replace('\\', '/')
    lines.append(f"file '{path}'\nduration {cs / 100:.2f}")
lines.append(lines[-1].split('\n')[0])  # concat demuxer needs the last file repeated
listing = os.path.join(frames, 'list.txt')
open(listing, 'w').write('\n'.join(lines) + '\n')

os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
graph = 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listing,
                '-filter_complex', graph, '-fps_mode', 'vfr', '-loop', '0', out], check=True)
print(f"{out}: {len(merged)} frames, {sum(f['ms'] for f in merged) / 1000:.1f} s, "
      f"{os.path.getsize(out) / 1e6:.2f} MB")
