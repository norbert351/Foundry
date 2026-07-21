#!/usr/bin/env python3
"""Build Foundry demo video — screen recording style with voiceover."""
import json, os, textwrap, io
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Try moviepy — fallback to pure ffmpeg if unavailable
try:
    from moviepy import AudioFileClip, ImageClip, CompositeVideoClip, concatenate_videoclips

    HAS_MOVIEPY = True
except ImportError:
    HAS_MOVIEPY = False

OUT = Path.home() / "foundry-demo"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1920, 1080
FPS = 24
BG = (10, 10, 10)
ACCENT = (0, 212, 170)
ORANGE = (255, 138, 61)
WHITE = (240, 240, 240)
GRAY = (120, 120, 120)
DIM = (60, 60, 60)

# Try to load a monospace font
FONT_DIRS = [
    "/usr/share/fonts/truetype/",
    "/usr/share/fonts/",
    "/System/Library/Fonts/",
]
MONO = None
for fd in FONT_DIRS:
    for root, dirs, files in os.walk(fd):
        for f in files:
            if f.endswith(".ttf") and "mono" in f.lower():
                MONO = os.path.join(root, f)
                break
        if MONO:
            break
    if MONO:
        break
if not MONO:
    MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
if not os.path.exists(MONO):
    MONO = None
    print("WARNING: no monospace font found, using default")

def getfont(size, bold=False):
    if MONO:
        return ImageFont.truetype(MONO, size)
    return ImageFont.load_default()


def render_terminal(text, title="~$ curl https://foundry-3657.onrender.com", w=W - 200, h=H - 200):
    """Render a terminal-style screenshot."""
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Terminal frame
    tw, th = w, h
    tx, ty = (W - tw) // 2, (H - th) // 2 + 40
    draw.rectangle([tx, ty, tx + tw, ty + th], fill=(20, 20, 20), outline=(50, 50, 50), width=2)

    # Title bar
    draw.rectangle([tx, ty, tx + tw, ty + 36], fill=(30, 30, 30), outline=(50, 50, 50), width=1)
    # Dots
    for dx, col in [(10, (255, 95, 87)), (28, (255, 189, 46)), (46, (40, 200, 64))]:
        draw.ellipse([tx + dx, ty + 12, tx + dx + 12, ty + 24], fill=col)
    font_s = getfont(14)
    draw.text((tx + 70, ty + 10), title, fill=(180, 180, 180), font=font_s)

    # Content
    font_c = getfont(16)
    cy = ty + 55
    for line in text.split("\n"):
        # Syntax highlighting
        if line.startswith("$ "):
            draw.text((tx + 25, cy), "$", fill=ACCENT, font=font_c)
            draw.text((tx + 40, cy), line[2:], fill=WHITE, font=font_c)
        elif line.startswith("# "):
            draw.text((tx + 25, cy), line, fill=GRAY, font=font_c)
        elif "✅" in line or "✓" in line or "200" in line:
            draw.text((tx + 25, cy), line, fill=ACCENT, font=font_c)
        elif "❌" in line or "error" in line.lower() or "402" in line:
            draw.text((tx + 25, cy), line, fill=ORANGE, font=font_c)
        elif '"verdict": "BUILD"' in line:
            draw.text((tx + 25, cy), line, fill=ACCENT, font=font_c)
        elif '"verdict": "KILL"' in line:
            draw.text((tx + 25, cy), line, fill=ORANGE, font=font_c)
        else:
            draw.text((tx + 25, cy), line, fill=WHITE, font=font_c)
        cy += 28
        if cy > ty + th - 30:
            break
    return img


def render_title(text, subtitle=""):
    """Render a clean title card."""
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Accent line
    draw.rectangle([W // 2 - 150, H // 2 - 100, W // 2 + 150, H // 2 - 96], fill=ACCENT)

    font_t = getfont(52)
    draw.text((W // 2, H // 2 - 30), text, fill=WHITE, font=font_t, anchor="mm")

    if subtitle:
        font_s = getfont(22)
        draw.text((W // 2, H // 2 + 40), subtitle, fill=GRAY, font=font_s, anchor="mm")

    # "Foundry" watermark
    font_w = getfont(14)
    draw.text((W - 20, H - 20), "Foundry — OKX.AI Genesis", fill=DIM, font=font_w, anchor="rb")
    return img


# ─── SCENE DEFINITIONS ──────────────────────────────────────────────────

SCENES = []

# 1. Title card
SCENES.append(("title", 4.0, lambda: render_title(
    "Foundry ASP",
    "The tool that helps other ASPs launch on OKX.AI"
)))

# 2. What is Foundry?
SCENES.append(("what", 6.0, lambda: render_terminal(
"""# Foundry: Pre-flight to post-flight for OKX.AI ASPs
#
# 7 services in 1 ASP:
#
$  1. Validate Idea     - BUILD / MAYBE / KILL verdict
$  2. Price Estimator   - Real market p25/median/p75
$  3. Lint Listing      - 28 rules, score 0-100
$  4. Bootstrap Trust   - EIP-191 signed badge
$  5. Instant Ship      - Draft → listing in 1 call
$  6. Scoreboard        - Public trust leaderboard
$  7. Competitor Radar  - Market competition map""",
    title="~$ foundry --help"
)))

# 3. Instant Ship demo
SCENES.append(("instant-ship", 8.0, lambda: render_terminal(
"""$ curl -X POST https://foundry-3657.onrender.com/v1/instant-ship \\
  -H "Content-Type: application/json" \\
  -d '{"draft": "# MyTradingBot\\n\\nAn AI agent that..."}'

# ⚡ One draft → ready-to-submit listing + CLI command

{
  "ship_id": "a9cceaab2d2b",
  "verdict": "BUILD",
  "lint_score": 100,
  "recommended_fee": 0.05,
  "cli_commands": {
    "pre_check": "onchainos agent pre-check --role asp",
    "create": "onchainos agent create --name MyTradingBot..."
  }
}

✅ Instant Ship — 0.8 seconds""",
    title="~$ POST /v1/instant-ship (FREE)"
)))

# 4. Competitor Radar
SCENES.append(("competitors", 6.0, lambda: render_terminal(
"""$ curl -s "https://foundry-3657.onrender.com/v1/competitors?\\
  category=FINANCE" | python3 -m json.tool

{
  "category": "FINANCE",
  "total_sellers": 77,
  "median_fee_usdt": 0.05,
  "competitors": [
    {"name": "Barker", "fee": 0.03, "sold": 340, ...},
    {"name": "WhaleWhisper", "fee": 0.01, "sold": 150, ...},
    ...
  ],
  "tips": ["77 sellers. Median fee 0.05 USDT."]
}

✅ Competitor Radar — market intel in 1 call""",
    title="~$ GET /v1/competitors (FREE)"
)))

# 5. Lint + Trust
SCENES.append(("lint-trust", 6.0, lambda: render_terminal(
"""# Step 1: Validate your listing
$ curl -X POST https://foundry-3657.onrender.com/v1/lint-listing \\
  -d '{"listing": {"name": "...", ...}}'

✅ Score: 95/100 — 2 warnings, 0 blocks

# Step 2: Get verified
$ curl -X POST https://foundry-3657.onrender.com/v1/bootstrap-trust \\
  -d '{"endpoint": "https://my-asp.com/v1/service"}'

✅ Foundry Verified — signature: 0x4a7d...
✅ Badge: https://foundry-3657.onrender.com/v1/badge/6956.svg""",
    title="~$ Lint + Trust pipeline"
)))

# 6. Scoreboard
SCENES.append(("scoreboard", 5.0, lambda: render_terminal(
"""$ curl https://foundry-3657.onrender.com/v1/verified

{
  "count": 5,
  "verified": [
    {"name": "Foundry ASP", "latency_ms": 120, "verified": true},
    {"name": "ForgeVault", "latency_ms": 85, "verified": true},
    ...
  ]
}

✅ Public Scoreboard — trust at a glance""",
    title="~$ GET /v1/verified (FREE)"
)))

# 7. Market x402 payments
SCENES.append(("x402", 5.0, lambda: render_terminal(
"""# Other agents pay with x402 (EIP-191 automatic)
$ curl -X POST /v1/validate-idea

HTTP 402 — PAYMENT-REQUIRED
→ Agent signs with its OKX wallet →
→ Replays with X-PAYMENT →
→ Gets the result

💰 0.005 USDT per call
💰 Agents pay agents — no human needed""",
    title="~$ x402 Payment Flow"
)))

# 8. Outro
SCENES.append(("outro", 4.0, lambda: render_title(
    "Ship a listing in 60 seconds.",
    "Foundry — OKX.AI Genesis Hackathon · Software Utility"
)))


# ─── BUILD VIDEO ────────────────────────────────────────────────────────

def build_demo():
    print("Rendering scenes...")
    clips = []
    for name, dur, fn in SCENES:
        img = fn()
        path = OUT / f"scene_{name}.png"
        img.save(path)
        print(f"  {name}: {dur}s -> {path.name}")
        clips.append((name, dur, path))

    # We'll build the video with ffmpeg directly
    return clips


def generate_voiceover_script():
    """Return the full narration aligned with scenes."""
    return {
        "title": "Foundry ASP. The tool that helps other agent service providers launch on the OKX.AI marketplace.",
        "what": "Foundry packs 7 services into one ASP. Validate your idea. Price it against real market data. Lint your listing across 28 review rules. Bootstrap trust with an on-chain signed badge. Generate a ready listing from any language in one call. Track your competitors. And prove your endpoint is live. All paid via x402.",
        "instant-ship": "The killer feature is Instant Ship. Paste a rough draft of your ASP idea in any language. Foundry parses it, checks market demand, prices it, lints it to 100, and returns the exact onchainos CLI command to register. From idea to marketplace submission in under a second.",
        "competitors": "The Competitor Radar is a free endpoint. Enter any category — Finance, Art, Software — and get ranked competitors with fees, sales volume, and market insights. Foundry scrapes over four hundred live listings to give you real data.",
        "lint-trust": "The Lint Listing engine scores your draft 0 to 100 against 28 rules learned from accepted OKX listings. It auto-fixes issues and rewrites descriptions. Then Bootstrap Trust calls your actual endpoint, measures latency, validates the JSON response, and signs an EIP-191 receipt you can embed as a badge on X.",
        "scoreboard": "The Public Scoreboard lists every Foundry Verified agent. Anyone can check if a seller is live and trustworthy before paying them. It's a reputation layer for the entire marketplace.",
        "x402": "All paid services use the x402 protocol. A calling agent gets a 402 payment challenge, signs it with their OKX wallet, replays the request, and gets the result. No human needed. Agents paying agents, automatically.",
        "outro": "Foundry. Ship a listing in sixty seconds. Built for the OKX AI Genesis Hackathon. Software Utility and Revenue Rocket categories.",
    }


if __name__ == "__main__":
    clips = build_demo()
    script = generate_voiceover_script()

    # Save scene info
    meta = {"scenes": [{"name": n, "duration": d, "narration": script.get(n, "")} for n, d, _ in clips]}
    (OUT / "scenes.json").write_text(json.dumps(meta, indent=2))
    print(f"\nDone. {len(clips)} scenes -> {OUT}/")
    print("Now generating voiceover and compiling video...")
