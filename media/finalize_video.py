"""Turns the raw Playwright recording into the final 1080p MP4 + SRT.

Waiting-for-block intervals are played 4x faster so the video stays near two minutes; captions are
already burned into the frames by record_demo.py and are also exported as an .srt file.
"""
import json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "media" / "out"
tl = json.loads((OUT / "timeline.json").read_text())
raw, total = tl["raw"], tl["total"]
SPEED = float(sys.argv[sys.argv.index("--speed") + 1]) if "--speed" in sys.argv else 4.0

# segments: (start, end, speed)
segs, t = [], 0.0
for a, b in sorted(tl["fast"]):
    if a > t:
        segs.append((t, a, 1.0))
    segs.append((a, b, SPEED))
    t = b
segs.append((t, total, 1.0))

def mapped(x):
    """Original time -> output time."""
    out = 0.0
    for a, b, s in segs:
        if x <= a:
            break
        out += (min(x, b) - a) / s
    return out

mp4 = OUT / "veridom-build-fund-demo.mp4"
tmp = OUT / "raw" / "segments"
tmp.mkdir(parents=True, exist_ok=True)
listing = []
# Encode each segment separately (memory-friendly), then concatenate without re-encoding.
for i, (a, b, s) in enumerate(segs):
    if b - a < 0.05:
        continue
    seg = tmp / f"seg{i:02d}.mp4"
    vf = f"setpts=(PTS-STARTPTS)/{s},scale=1920:1080:flags=lanczos,fps=30,format=yuv420p"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-threads", "2", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", raw,
                    "-vf", vf, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", str(seg)], check=True)
    listing.append(f"file '{seg}'")
(tmp / "list.txt").write_text("\n".join(listing) + "\n")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"),
                "-c", "copy", "-movflags", "+faststart", str(mp4)], check=True)

def ts(x):
    h, r = divmod(x, 3600); m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s % 1) * 1000):03d}"

caps = [(mapped(t0), text) for t0, text in tl["captions"]]
end = mapped(total)
srt = []
for i, (t0, text) in enumerate(caps):
    if not text:
        continue
    t1 = caps[i + 1][0] if i + 1 < len(caps) else end
    srt.append(f"{len(srt) + 1}\n{ts(t0)} --> {ts(t1)}\n{text}\n")
(OUT / "veridom-build-fund-demo.srt").write_text("\n".join(srt))
dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)], capture_output=True, text=True).stdout.strip()
print(f"{mp4} · {float(dur):.1f}s · {mp4.stat().st_size / 1e6:.1f} MB")
