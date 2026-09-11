// Shared procedural surfaces. 6 x 128 RGBA reflection faces plus two tiny maps < 0.6 MiB.
let shared
export function unitMaterials(E) {
  if (shared) return shared
  const canvas = (size, paint) => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    paint(c.getContext('2d'), size)
    return c
  }
  const rough = canvas(128, (ctx, n) => {
    const data = ctx.createImageData(n, n)
    let seed = 2029
    for (let i = 0; i < n * n; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const value = 170 + (seed >>> 27) + 25 * Math.sin((i % n) * 3.7)
      data.data.set([value, value, value, 255], i * 4)
    }
    ctx.putImageData(data, 0, 0)
  })
  const roughnessMap = new E.CanvasTexture(rough)
  roughnessMap.wrapS = roughnessMap.wrapT = E.RepeatWrapping
  const faces = Array.from({length: 6}, (_, face) => canvas(128, (ctx, n) => {
    const g = ctx.createLinearGradient(0, 0, n, n)
    g.addColorStop(0, '#10151d'); g.addColorStop(.3, '#334759')
    g.addColorStop(.42, face === 2 ? '#dceaff' : '#b4c9dc')
    g.addColorStop(.49, '#1a2027'); g.addColorStop(.78, '#07090d')
    g.addColorStop(1, '#706254')
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n)
    ctx.fillStyle = '#e1e6e9'; ctx.fillRect(face % 2 ? 83 : 20, 12, 5, 95)
  }))
  const envMap = new E.CubeTexture(faces)
  envMap.colorSpace = E.SRGBColorSpace
  envMap.needsUpdate = true
  const metal = new E.PhysicalMaterial({name: 'Unit brushed steel and worn chrome', color: 0xffffff,
    vertexColors: true, metalness: .96, roughness: .48, roughnessMap, envMap, envMapIntensity: .75})
  metal.registerMaterialExtensions([{
    uuid: 'terminator-steel-v1', computeCacheKey: 'terminator-steel-v1',
    parsVertexSnippet: 'attribute float unitRoughness; varying float vUnitRoughness;',
    parsFragmentSnippet: 'varying float vUnitRoughness;',
    shaderExtender(shader) {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvUnitRoughness = unitRoughness;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vUnitRoughness;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight += vec3(0.035, 0.048, 0.065) * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);\n#include <opaque_fragment>')
    },
  }])
  const glowMap = new E.CanvasTexture(canvas(64, (ctx, n) => {
    const g = ctx.createRadialGradient(n/2, n/2, 0, n/2, n/2, n/2)
    g.addColorStop(0, '#ffffffff'); g.addColorStop(.16, '#ffffffd0')
    g.addColorStop(.42, '#ffffff38'); g.addColorStop(1, '#ffffff00')
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n)
  }))
  const eye = new E.PhysicalMaterial({name: 'Red optical emitter', color: 0x210000,
    emissive: 0xff0800, emissiveIntensity: 6, roughness: .2, metalness: .2})
  const halo = new E.UnlitMaterial({name: 'Optical bloom', color: 0xff1608, map: glowMap,
    transparent: true, depthWrite: false, blending: E.AdditiveBlending, side: E.DoubleSide})
  shared = {metal, eye, halo, glowMap, textureBytes: (6 * 128 * 128 + 128 * 128 + 64 * 64) * 4 * 4 / 3}
  return shared
}
