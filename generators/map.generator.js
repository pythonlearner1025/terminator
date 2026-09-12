import {createMapGroup, createMapPreviewGroup} from './map.geometry.js'

// params.detail: "light" (fast unlit blocks) or "full" (the textured PBR environment the game
// builds at Play, for authoring with real materials in edit mode; the project default). The
// headless check (?headless=check) always builds the light preview so its render budget holds.
const headlessCheck = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('headless') === 'check'

export default async function generate({params, engine, viewer}) {
  const response = await fetch(new URL('../lib/core/data/map.json', import.meta.url))
  if (!response.ok) throw new Error(`Could not load map data: ${response.status}`)
  const map = await response.json()
  const markers = params.markers !== false
  const full = params.detail === 'full' && !headlessCheck()
  const preview = full
    ? createMapGroup(engine, map, {markers, runtime: false})
    : createMapPreviewGroup(engine, map, {markers})
  if (full) {
    await preview.mapReady
    if (viewer) {
      const sky = await viewer.import(new URL('../assets/hdri/qwantani_moon_noon_puresky_2k.hdr', import.meta.url).href)
      preview.traverse(object => {
        if (object.material?.isMeshStandardMaterial) { object.material.envMap = sky; object.material.envMapIntensity = .32 }
      })
      preview.mapTextures.push(sky)
    }
  }
  preview.name = `${map.name} ${full ? 'Environment' : 'Preview'}`
  return preview
}
