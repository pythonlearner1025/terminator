import {unitMaterials} from './unit-materials.js'

let shared
// Reuse the enemies' tiny wear map and reflection probe. Only the fatigue dye
// differs between guests; skin, leather, webbing and hardware keep their colors.
export function soldierMaterials(E) {
  if (shared) return shared
  const {metal} = unitMaterials(E)
  const make = (variant, dye) => {
    const material = new E.PhysicalMaterial({
      name: `Resistance ${variant} worn fatigues`, vertexColors: true,
      color: 0xffffff, metalness: 1, roughness: 1,
      roughnessMap: metal.roughnessMap, envMap: metal.envMap, envMapIntensity: .65,
    })
    material.registerMaterialExtensions([{
      uuid: `terminator-soldier-${variant}`, computeCacheKey: `terminator-soldier-${variant}-v1`,
      extraUniforms: {soldierDye: {value: new E.Color(dye)}},
      parsVertexSnippet: 'attribute vec3 soldierSurface; varying vec3 vSoldierSurface;',
      parsFragmentSnippet: 'uniform vec3 soldierDye; varying vec3 vSoldierSurface;',
      shaderExtender(shader) {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSoldierSurface = soldierSurface;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), soldierDye, vSoldierSurface.z);')
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vSoldierSurface.y;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vSoldierSurface.x;')
      },
    }])
    return material
  }
  shared = {
    olive: make('olive', 0x697350), gray: make('gray', 0x78818a),
    lamp: new E.PhysicalMaterial({name: 'Resistance warm headlamp lens', color: 0xffecc5,
      emissive: 0xffd49a, emissiveIntensity: 2.4, roughness: .24, metalness: .25}),
  }
  return shared
}

export function soldierPreviewMaterials(E) {
  const make = (variant, color) => new E.UnlitMaterial({
    name: `Resistance ${variant} authoring preview`, color,
  })
  return {
    olive: make('olive', 0xb8c49a), gray: make('gray', 0xc3ccd4),
    lamp: new E.UnlitMaterial({name: 'Resistance authoring preview headlamp', color: 0xffecc5}),
  }
}
