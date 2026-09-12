"""Deterministic 1024px worn steel maps for the presentation stage. No source images."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/store/materials'
OUT.mkdir(parents=True, exist_ok=True)
N = 1024
rng = np.random.default_rng(2029)

def noise(size):
    source = Image.fromarray(rng.integers(0, 256, (size, size), dtype=np.uint8))
    return np.asarray(source.resize((N, N), Image.Resampling.BICUBIC), dtype=float) / 255

grain = noise(512)
cloud = noise(16) * .55 + noise(64) * .3 + noise(128) * .15
scratches = Image.new('L', (N, N))
draw = ImageDraw.Draw(scratches)
for _ in range(1500):
    x, y = rng.integers(0, N, 2)
    length = rng.integers(5, 110)
    draw.line((x, y, x + length, y + int(rng.integers(-3, 4))), fill=int(rng.integers(20, 180)), width=1)
for _ in range(90):
    x, y = rng.integers(0, N, 2)
    draw.line((x, y, x + int(rng.integers(10, 120)), y + int(rng.integers(-80, 80))), fill=160, width=1)
scratch = np.asarray(scratches.filter(ImageFilter.GaussianBlur(.4)), dtype=float) / 255
pits = np.maximum(0, grain - .77) * 4
oxidation = np.clip((cloud - .62) * 4, 0, 1)
height = cloud * .03 + grain * .007 - scratch * .065 - pits * .035
dy, dx = np.gradient(height)
normals = np.stack((-dx * 9, dy * 9, np.ones_like(dx)), axis=-1)
normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
albedo = (130 + cloud * 30 + grain * 13 + scratch * 70 - pits * 30)[..., None] * np.array([.91, .95, 1])
albedo = albedo * (1 - oxidation[..., None] * .45) + oxidation[..., None] * np.array([47, 21, 8])

def save(name, data):
    Image.fromarray(np.uint8(np.clip(data, 0, 255))).save(OUT / f'steel-{name}.png', optimize=True)

save('albedo', albedo)
save('normal', (normals * .5 + .5) * 255)
save('roughness', 94 + cloud * 53 + grain * 24 + oxidation * 60 - scratch * 65)
save('metalness', 247 - oxidation * 125 - pits * 25)
save('ao', 250 - pits * 75 - scratch * 22)
y, x = np.mgrid[:N, :N] / N * 2 - 1
optic = np.exp(-(x*x + y*y) * 5) * 255
save('emissive', np.stack((np.full_like(optic,255), np.full_like(optic,255), np.full_like(optic,255), optic), axis=-1))
print('Wrote six 1024x1024 procedural material maps')
