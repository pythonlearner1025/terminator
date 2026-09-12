"""Original 512px hydraulic fluid maps. No external image inputs."""
from pathlib import Path
import numpy as np
from PIL import Image

out = Path(__file__).resolve().parents[1] / 'assets/textures/gore'
out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(20290912)
y, x = np.mgrid[-1:1:512j, -1:1:512j]
angle = np.arctan2(y, x)
radius = np.hypot(x, y)
edge = .62 + .06 * np.sin(angle * 7) + .038 * np.cos(angle * 13 + 2)
field = edge - radius
for _ in range(28):
    a, d, r = rng.uniform(0, 6.283), rng.uniform(.55, .88), rng.uniform(.014, .07)
    field = np.maximum(field, r - np.hypot(x - np.cos(a) * d, y - np.sin(a) * d))
alpha = np.clip(field * 220, 0, 1)
ripples = np.sin(radius * 108 + np.sin(angle * 5) * 2) * .002
height = np.clip(field * 15, 0, 1) * .014 + ripples * alpha
dy, dx = np.gradient(height)
normal = np.dstack((-dx * 110, -dy * 110, np.ones_like(x)))
normal /= np.linalg.norm(normal, axis=2, keepdims=True)
noise = rng.random(x.shape)
albedo = np.dstack((9 + noise * 6, 12 + noise * 7, 13 + noise * 7, alpha * 255))
orm = np.dstack((190 + alpha * 60, 34 + noise * 24 + (1-alpha)*180, np.zeros_like(x)))
Image.fromarray(albedo.astype('uint8')).save(out / 'fluid-albedo.png')
Image.fromarray(((normal * .5 + .5) * 255).astype('uint8')).save(out / 'fluid-normal.png')
Image.fromarray(orm.astype('uint8')).save(out / 'fluid-orm.png')
