#!/bin/bash
set -e

# Segment 1: Intro (15s)
ffmpeg -y -loop 1 -t 15 -i slide1_intro.png -i full_narration.mp3 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,fade=t=in:st=0:d=0.5" \
  -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p \
  -an seg1.mp4 2>/dev/null

# Segment 2: Instant Ship (35s)
ffmpeg -y -loop 1 -t 35 -i slide2_instantship.png -i full_narration.mp3 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,fade=t=in:st=0:d=0.5" \
  -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p \
  -an seg2.mp4 2>/dev/null

# Segment 3: Competitors (20s)
ffmpeg -y -loop 1 -t 20 -i slide3_competitors.png \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,fade=t=in:st=0:d=0.5" \
  -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p \
  -an seg3.mp4 2>/dev/null

# Segment 4: Verified (15s)
ffmpeg -y -loop 1 -t 15 -i slide4_verified.png \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,fade=t=in:st=0:d=0.5" \
  -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p \
  -an seg4.mp4 2>/dev/null

# Segment 5: Paid services (25s)
ffmpeg -y -loop 1 -t 25 -i slide5_paid.png \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,fade=t=in:st=0:d=0.5" \
  -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p \
  -an seg5.mp4 2>/dev/null

# Segment 6: Outro (15s) - reuse intro slide
ffmpeg -y -loop 1 -t 15 -i slide1_intro.png \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,fade=t=in:st=0:d=0.5" \
  -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p \
  -an seg6.mp4 2>/dev/null

echo "Segments built"
