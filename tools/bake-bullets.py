"""Bake deterministic 512px jacket wear and heat maps. No external pixels."""
from pathlib import Path
import numpy as np
from PIL import Image
out = Path(__file__).resolve().parents[1] / 'assets/textures/bullets'
out.mkdir(parents=True, exist_ok=True)
n = 512
rng = np.random.default_rng(20290912)
y, x = np.mgrid[:n, :n] / n
noise = rng.random((n, n))
groove = np.exp(-((y - .19) / .008) ** 2)
scuff = np.zeros((n, n))
for _ in range(90):
    px, py = rng.random(2)
    scuff += np.exp(-((x-px)/.002)**2 - ((y-py)/.055)**2)
scuff = np.clip(scuff, 0, 1)
height = noise*.018 + np.sin(y*1700)*.009 - groove*.12 + scuff*.035
dy, dx = np.gradient(height)
normal = np.stack([-dx*5, dy*5, np.ones_like(dx)], -1)
normal /= np.linalg.norm(normal, axis=2)[..., None]
albedo = np.clip(.7 + noise*.055 + scuff*.15 - groove*.22, 0, 1)
heat = np.clip(1 - (1-y)/.23, 0, 1)**2
maps = {'albedo': np.stack([albedo, albedo*.95, albedo*.86], -1),
        'normal': normal*.5+.5, 'roughness': .38+noise*.12-scuff*.19+groove*.2,
        'metalness': .96-scuff*.08, 'ao': .98-groove*.22,
        'emissive': heat*(.85+noise*.15)}
for name, data in maps.items():
    if data.ndim == 2: data = np.repeat(data[..., None], 3, axis=2)
    Image.fromarray(np.uint8(np.clip(data, 0, 1)*255)).save(out/f'bullet-{name}.png', optimize=True)
