"""Bake the unit atlas and damage textures. Run with Python 3, Pillow and numpy.

Original deterministic surface synthesis, no downloaded or proprietary image inputs.
Four 1024px tiles with 16px gutters: steel, chrome, oil-dark metal, worn edges.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / 'assets/textures/units'
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(2029)
N = 1024
y, x = np.mgrid[0:N, 0:N].astype(float) / (N - 1)

def noise(size, blur=0):
    a = Image.fromarray(rng.integers(0, 256, (size, size), dtype=np.uint8)).resize((N, N), Image.Resampling.BICUBIC)
    if blur:
        a = a.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(a).astype(float) / 255

albedo = np.zeros((N*2, N*2, 3), dtype=np.uint8)
normal = albedo.copy()
orm = albedo.copy()
for tile, (base, rough) in enumerate([(100, .46), (190, .20), (33, .64), (158, .31)]):
    cloud = .5*noise(12) + .3*noise(42) + .2*noise(175)
    micro = noise(N)
    scratch = Image.new('L', (N, N))
    d = ImageDraw.Draw(scratch)
    for i in range(1300):
        sx, sy = rng.integers(16, N-16, 2)
        length = rng.integers(3, 160)
        d.line((int(sx), int(sy), int(sx+length), int(sy+rng.integers(-3, 4))), fill=int(rng.integers(30, 150)), width=1)
    for i in range(95):
        sx, sy = rng.integers(16, N-16, 2)
        d.line((int(sx), int(sy), int(sx+rng.integers(-60, 60)), int(sy+rng.integers(4, 80))), fill=175, width=1)
    scratches = np.asarray(scratch).astype(float)/255
    border = np.minimum.reduce([x, 1-x, y, 1-y])
    wear = np.exp(-border*100) * (.35+.65*noise(80))
    grime = np.clip((.56-cloud)*3, 0, .65) * (1-wear)
    brush = np.sin(y*N*2.2 + noise(32)*3)*.6
    height = micro*.001 + cloud*.008 - scratches*.018 + wear*.009
    gy, gx = np.gradient(height)
    vectors = np.stack([-gx*3, gy*3, np.ones_like(gx)], -1)
    vectors /= np.linalg.norm(vectors, axis=-1, keepdims=True)
    color = base + (cloud-.5)*12 + brush*.3 + micro*2 - grime*(14 if tile != 1 else 5) + scratches*14 + wear*32
    rgb = np.stack([color*.97, color, color*1.025], -1)
    maps = [np.clip(rgb, 0, 255).astype(np.uint8), ((vectors*.5+.5)*255).astype(np.uint8),
            np.clip(np.stack([1-grime*.5, rough+grime*.12+scratches*.06-wear*.12, .98-grime*.12], -1)*255, 0, 255).astype(np.uint8)]
    for atlas, data in zip([albedo, normal, orm], maps):
        # Extend texels into a gutter to prevent adjacent metals bleeding at mips.
        data[:16] = data[16]; data[-16:] = data[-17]
        data[:, :16] = data[:, 16:17]; data[:, -16:] = data[:, -17:-16]
        row, col = divmod(tile, 2)
        atlas[row*N:(row+1)*N, col*N:(col+1)*N] = data
Image.fromarray(albedo).save(OUT/'endoskeleton-albedo.jpg', quality=95, subsampling=0)
Image.fromarray(normal).save(OUT/'endoskeleton-normal.png', optimize=True)
Image.fromarray(orm).save(OUT/'endoskeleton-orm.png', optimize=True)

# Optical glass: concentric machining, radial emission, and a small hot core.
N = 256
y, x = np.mgrid[-1:1:complex(N), -1:1:complex(N)]
r = np.hypot(x, y)
rings = np.sin(r*95)*.5+.5
rgb = np.stack([50+rings*45, 8+rings*8, 4+rings*3], -1)
Image.fromarray(np.uint8(rgb)).save(OUT/'optic-albedo.png')
nx, ny = x*.14*np.sin(r*95), -y*.14*np.sin(r*95)
Image.fromarray(np.uint8(np.clip(np.stack([nx+.5, ny+.5, np.ones_like(x)*.99], -1)*255, 0, 255))).save(OUT/'optic-normal.png')
Image.fromarray(np.uint8(np.stack([np.ones_like(x)*255, 38+rings*40, np.ones_like(x)*95], -1))).save(OUT/'optic-orm.png')
power = np.clip((1-r)*1.5, 0, 1)**2
Image.fromarray(np.uint8(np.stack([power*255, power*14, power*3], -1))).save(OUT/'optic-emissive.png')

# Persistent scorch with torn edges, a depressed normal and oil-dark roughness.
N = 512
y, x = np.mgrid[-1:1:complex(N), -1:1:complex(N)]
r = np.hypot(x, y)
theta = np.arctan2(y, x)
edge = r*(1+.13*np.sin(theta*17)+.06*np.sin(theta*31))
alpha = np.clip((.9-edge)*5, 0, 1)
pit = np.exp(-r*r*22)
rim = np.exp(-((r-.31)*17)**2)
v = 11+rim*88 + rng.random((N,N))*9
Image.fromarray(np.uint8(np.stack([v, v*.9, v*.8, alpha*255], -1))).save(OUT/'impact-albedo.png')
gy, gx = np.gradient(-pit*.9+rim*.3)
v = np.stack([-gx*7, gy*7, np.ones_like(x)], -1)
v /= np.linalg.norm(v, axis=-1, keepdims=True)
Image.fromarray(np.uint8((v*.5+.5)*255)).save(OUT/'impact-normal.png')
Image.fromarray(np.uint8(np.stack([255-pit*110, 175-rim*90, 35+rim*195], -1))).save(OUT/'impact-orm.png')
print('Baked 10 unit textures in assets/textures/units')
