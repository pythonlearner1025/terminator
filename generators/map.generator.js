import {createMapGroup} from '../lib/view/map.js'

export default async function generate({params, engine}) {
  const response = await fetch(new URL('../lib/core/data/map.json', import.meta.url))
  if (!response.ok) throw new Error(`Could not load map data: ${response.status}`)
  const map = await response.json()
  const preview = createMapGroup(engine, map, {markers: params.markers !== false})
  preview.name = `${map.name} Preview`
  return preview
}
