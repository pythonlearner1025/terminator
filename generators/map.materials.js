// Deterministic, local canvas textures. No downloaded images or global GPU caches.
export function randomSource(seed = 2029) {
  return () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296 }
}

export function mapMaterials(api) {
  const rand = randomSource()
  const textures = []
  function canvasTexture(draw, w = 512, h = 512) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    draw(canvas.getContext('2d'), w, h)
    const texture = new api.CanvasTexture(canvas)
    texture.colorSpace = api.SRGBColorSpace
    texture.wrapS = texture.wrapT = api.RepeatWrapping
    texture.anisotropy = 4
    textures.push(texture)
    return texture
  }
  const surface = (base, steel = false) => canvasTexture((ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 18000; i++) {
      const v = Math.floor(rand() * 140)
      ctx.fillStyle = `rgba(${v},${v},${v},${rand() * 0.2})`
      ctx.fillRect(rand() * w, rand() * h, rand() * 3 + 1, rand() * 3 + 1)
    }
    for (let i = 0; i < 60; i++) {
      const x = rand() * w, y = rand() * h
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 8 + rand() * 70)
      gradient.addColorStop(0, steel ? '#71371070' : '#0a151940'); gradient.addColorStop(1, '#00000000')
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h)
    }
    ctx.strokeStyle = '#0d151977'; ctx.lineWidth = 2
    if (steel) {
      for (let x = 0; x < w; x += 64) {
        ctx.fillStyle = '#a1a3a322'; ctx.fillRect(x, 0, 5, h)
        ctx.fillStyle = '#050b1044'; ctx.fillRect(x + 6, 0, 4, h)
      }
    } else {
      ctx.strokeRect(1, 1, w - 2, h - 2)
      for (let i = 0; i < 8; i++) {
        let x = rand() * w, y = rand() * h
        ctx.beginPath(); ctx.moveTo(x, y)
        for (let j = 0; j < 5; j++) { x += (rand() - 0.5) * 70; y += rand() * 40; ctx.lineTo(x, y) }
        ctx.stroke()
      }
    }
  })
  const concrete = surface('#747d85'), asphalt = surface('#434c54'), rust = surface('#655044', true)
  const corrugated = surface('#879095', true)
  const lit = (name, color, map = concrete, metalness = 0.05) => {
    const mat = new api.PhysicalMaterial({color, map, roughness: metalness ? 0.78 : 0.94, metalness, bumpMap: map, bumpScale: 0.055})
    mat.name = `Map ${name}`
    return mat
  }
  const glow = (name, color, intensity = 3) => {
    const mat = new api.PhysicalMaterial({color, emissive: color, emissiveIntensity: intensity, roughness: 0.8})
    mat.name = `Map ${name}`
    return mat
  }
  const mats = {
    concrete: lit('weathered concrete', 0x8997a5), ground: lit('cracked asphalt', 0x788899, asphalt),
    dark: lit('blackened steel', 0x293841, rust, 0.55), rust: lit('oxidized steel', 0x977053, rust, 0.6),
    red: lit('oxide container', 0x975244, corrugated, 0.5), blue: lit('navy container', 0x426577, corrugated, 0.5),
    steel: lit('galvanized steel', 0x78838a, corrugated, 0.6), yellow: lit('worn safety ochre', 0xc7a655, rust),
    truck: lit('resistance truck olive', 0x5e6861, rust, 0.5), rubber: lit('charred rubber', 0x151e23, asphalt),
    redGlow: glow('Skynet signal', 0xff170a, 5), orangeGlow: glow('fire', 0xff6512, 5),
    whiteGlow: glow('fluorescent', 0xb5e1ed, 3), greenGlow: glow('resistance signal', 0x52ffbd, 3),
    electricGlow: glow('electrical arcs', 0x68c9ff, 6),
  }
  function label(text, color = '#c5cccb', background = '#162128') {
    const texture = canvasTexture((ctx, w, h) => {
      ctx.fillStyle = background; ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(9, 9, w - 18, h - 18)
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const lines = text.split('\n')
      ctx.font = `bold ${lines.length > 1 ? 47 : 68}px monospace`
      lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 57, w - 34))
      for (let i = 0; i < 280; i++) { ctx.fillStyle = '#16212850'; ctx.fillRect(rand() * w, rand() * h, rand() * 8, 2) }
    }, 512, 192)
    const mat = new api.PhysicalMaterial({map: texture, roughness: 1, side: api.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2})
    mat.name = `Map stencil ${text.replaceAll('\n', ' ')}`
    return mat
  }
  const particle = canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, '#ffffffff'); g.addColorStop(0.25, '#ffffff90'); g.addColorStop(1, '#ffffff00')
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  }, 64, 64)
  const flame = canvasTexture((ctx, w, h) => {
    for (let i = 0; i < 7; i++) {
      const x = w * (0.2 + i * 0.1), height = h * (0.45 + rand() * 0.5)
      const g = ctx.createLinearGradient(0, h, 0, h - height)
      g.addColorStop(0, '#fffbd0ee'); g.addColorStop(0.3, '#ffbb32dd'); g.addColorStop(0.75, '#fa500b77'); g.addColorStop(1, '#ff170000')
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 22, h)
      ctx.bezierCurveTo(x - 34, h - height * 0.5, x + 24, h - height * 0.5, x + 12, h - height)
      ctx.bezierCurveTo(x + 48, h - height * 0.3, x + 30, h - height * 0.3, x + 22, h)
      ctx.fill()
    }
  }, 128, 256)
  return {mats, label, particle, flame, textures}
}
