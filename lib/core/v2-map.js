import {buildMapFromPlacements} from './map.js'
import {withV2ArchitectureCover} from './v2-cover.js'
import {getV2ArchitectureCover} from '../view/v2/architecture-cover.js'

// Both simulation and stopped preview consume the same declared layout.
// No render-time collider mutation: World builds its NavGrid from this result.
export function buildV2PlayableMap(rules, registry, placements) {
  const map=buildMapFromPlacements(rules, registry, placements)
  return withV2ArchitectureCover(map,getV2ArchitectureCover(map))
}
