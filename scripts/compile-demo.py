#!/usr/bin/env python3
"""Compile Foundry demo video from scene images + audio files."""
import subprocess, os, json, tempfile
from pathlib import Path

OUT = Path.home() / "foundry-demo"
FINAL = OUT / "foundry-demo-video.mp4"
FPS = 24
W, H = 1920, 1080

# Scene definitions: (name, duration_sec)
# Duration adjusted so each audio segment fits
SCENES = [
    ("title", 5.0),
    ("what", 11.0),
    ("instant-ship", 10.0),
    ("competitors", 9.0),
    ("lint-trust", 10.0),
    ("scoreboard", 7.0),
    ("x402", 8.0),
    ("outro", 5.0),
]

segments = []

for i, (name, dur) in enumerate(SCENES):
    img = OUT / f"scene_{name}.png"
    audio = OUT / f"audio_{name}.ogg"
    seg_out = OUT / f"seg_{i:02d}.mp4"

    if not img.exists():
        print(f"SKIP {name}: no image")
        continue
    if not audio.exists():
        print(f"SKIP {name}: no audio")
        continue

    # Get actual audio duration
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(audio)],
        capture_output=True, text=True
    )
    ad = json.loads(probe.stdout)
    audio_dur = float(ad.get("format", {}).get("duration", dur))
    
    # Show image for audio duration + 0.5s padding
    actual = max(dur, audio_dur + 0.5)
    
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", str(img),
        "-i", str(audio),
        "-c:v", "libx264",
        "-t", str(actual),
        "-pix_fmt", "yuv420p",
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "-r", str(FPS),
        str(seg_out),
    ]
    
    print(f"[{i+1}/{len(SCENES)}] {name} -> {actual:.1f}s (audio: {audio_dur:.1f}s)")
    subprocess.run(cmd, capture_output=True)
    
    if seg_out.exists():
        segments.append(seg_out)

print(f"\nConcatenating {len(segments)} segments...")

# Create concat file
concat_file = OUT / "concat.txt"
concat_file.write_text("\n".join(f"file '{s}'" for s in segments))

# Concatenate
concat_cmd = [
    "ffmpeg", "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", str(concat_file),
    "-c:v", "libx264",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-r", str(FPS),
    str(FINAL),
]

result = subprocess.run(concat_cmd, capture_output=True, text=True)
if result.returncode == 0:
    # Verify
    probe_result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(FINAL)],
        capture_output=True, text=True
    )
    info = json.loads(probe_result.stdout)
    fmt = info.get("format", {})
    dur_total = float(fmt.get("duration", 0))
    size = os.path.getsize(FINAL)
    print(f"\n✅ Final video: {FINAL.name}")
    print(f"   Duration: {dur_total:.1f}s")
    print(f"   Size: {size / 1024 / 1024:.1f} MB")
    print(f"   Resolution: {W}x{H} @ {FPS}fps")
else:
    print(f"❌ Concatenation failed:")
    print(result.stderr[:500])
