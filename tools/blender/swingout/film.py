"""Assemble the actual quarter-speed browser capture. This never changes game poses."""
from pathlib import Path
from PIL import Image, ImageDraw
import subprocess

source = Path('.kite3d/swingout-film')
output = Path('tools/blender/swingout/rounds/game')
frames = {
 'fire': [0, 2, 4, 5, 6, 7, 8, 10, 14, 20, 35, 59],
 'reload': [0, 18, 30, 40, 55, 72, 94, 108, 125, 148, 171, 195, 215, 240, 260, 280, 300, 327],
}
for name, indexes in frames.items():
 subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i',
  str(source / (name+'-%04d.jpg')), '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
  str(output / (name+'-quarter.mp4'))], check=True)
 sheet = Image.new('RGB', (1440, 300*((len(indexes)+3)//4)), '#14222a')
 draw = ImageDraw.Draw(sheet)
 for cell, index in enumerate(indexes):
  picture = Image.open(source / f'{name}-{index:04}.jpg').crop((300, 220, 1100, 720))
  picture.thumbnail((360, 270)); x = cell % 4 * 360; y = cell // 4 * 300
  sheet.paste(picture, (x, y))
  draw.text((x+8, y+277), f'{name} {(index+1)/120:.3f}s game', fill='white')
 sheet.save(output / (name+'-quarter-contact.jpg'), quality=93)
