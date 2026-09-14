/** Add declared architectural cover before constructing World and its NavGrid.
 * Pure: source map/collider records and the owner's layout remain untouched.
 * Rendering must consume these same declared collider IDs and pile metadata.
 */
export function withV2ArchitectureCover(map, specs) {
  if (!Array.isArray(map?.colliders) || !Array.isArray(specs)) throw new TypeError('Cover requires map.colliders and a layout array')
  const existing = new Map(map.colliders.map(collider => [collider.id, collider]))
  const additions = [], seen = new Set()
  for (const spec of specs) {
    if (!spec || typeof spec.id !== 'string' || !spec.id.startsWith('v2_arch_cover_') || seen.has(spec.id)) throw new Error('Invalid or duplicate architectural cover ID')
    seen.add(spec.id)
    if (spec.kind !== 'rubble' || spec.navBlock !== true || spec.blocksSight !== true) throw new Error(`Cover must block movement and sight: ${spec.id}`)
    vector(spec.center, false, spec.id); vector(spec.size, true, spec.id)
    if (spec.yaw !== undefined && !Number.isFinite(spec.yaw)) throw new Error(`Invalid cover yaw: ${spec.id}`)
    if (spec.shape !== undefined && spec.shape !== 'box') throw new Error(`Unsupported cover shape: ${spec.id}`)
    if (spec.shapes !== undefined) {
      if (!Array.isArray(spec.shapes) || !spec.shapes.length) throw new Error(`Empty cover solid: ${spec.id}`)
      for (const part of spec.shapes) {
        if (part.shape !== undefined && part.shape !== 'box') throw new Error(`Unsupported cover primitive: ${spec.id}`)
        vector(part.size, true, spec.id)
        if (part.offset !== undefined) vector(part.offset, false, spec.id)
        if (part.yaw !== undefined && !Number.isFinite(part.yaw)) throw new Error(`Invalid cover primitive yaw: ${spec.id}`)
      }
    }
    const owned = {...structuredClone(spec), v2ArchitectureCover: true}
    const previous = existing.get(spec.id)
    if (previous) {
      if (!previous.v2ArchitectureCover || canonical(previous) !== canonical(owned)) throw new Error(`Cover would replace an existing collider: ${spec.id}`)
    } else additions.push(owned)
  }
  return additions.length ? {...map, colliders: [...map.colliders, ...additions]} : map
}

function vector(value, positive, id) {
  if (!value || ['x', 'y', 'z'].some(axis => !Number.isFinite(value[axis]) || (positive && value[axis] <= 0))) throw new Error(`Invalid cover vector: ${id}`)
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
