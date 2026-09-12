import {createMapGroup, createMapPreviewGroup} from './map.geometry.js'

// params.detail: "light" (default, fast unlit blocks for the editor) or "full" (the textured PBR
// environment the game builds at Play, for authoring with real materials in edit mode).

export default async function generate({params, engine}) {
  const response = await fetch(new URL('../lib/core/data/map.json', import.meta.url))
  if (!response.ok) throw new Error(`Could not load map data: ${response.status}`)
  const map = await response.json()
  const markers = params.markers !== false
  const preview = params.detail === 'full'
    ? createMapGroup(engine, map, {markers, runtime: false})
    : createMapPreviewGroup(engine, map, {markers})
  preview.name = `${map.name} ${params.detail === 'full' ? 'Environment' : 'Preview'}`
  return preview
}
