import {Skeleton} from 'threepipe'

export function placedUnitFigure(source, type, detail = 'high') {
  let figure = null
  source?.traverse(child => {
    if (!figure && child.userData.unitAssetDetail === detail) figure = child
  })
  if (!figure) throw new Error(`${type} placed asset is missing its ${detail} figure`)
  return figure
}

export function cloneSkinnedFigure(source) {
  const clone = source.clone(true)
  // Loader display names can be suffixed while userData.name retains the
  // authored name. Skeleton references identify objects, not display names.
  // Pair the recursive clone with its source before restoring those names.
  const counterparts = new Map()
  const pair = (original, child) => {
    counterparts.set(original, child)
    if (typeof child.userData.name === 'string') child.name = child.userData.name
    if (original.children.length !== child.children.length) throw new Error(`${source.name} clone hierarchy changed`)
    for (let i = 0; i < original.children.length; i++) pair(original.children[i], child.children[i])
  }
  pair(source, clone)
  const localBones = [...counterparts.keys()].filter(object => object.isBone)
  const authoredName = bone => (typeof bone.userData.name === 'string' ? bone.userData.name : bone.name).replaceAll('_', ' ')
  const resolveBone = bone => {
    const paired = counterparts.get(bone)
    if (paired) return paired
    // Nested imports may clone a hierarchy while retaining its original
    // skeleton references. Accept only an unambiguous local counterpart.
    const id = bone.userData.gltfUUID
    const sameId = id ? localBones.filter(local => local.userData.gltfUUID === id) : []
    if (sameId.length) return sameId.length === 1 ? counterparts.get(sameId[0]) : undefined
    const name = authoredName(bone)
    const sameName = name ? localBones.filter(local => authoredName(local) === name) : []
    return sameName.length === 1 ? counterparts.get(sameName[0]) : undefined
  }
  clone.traverse(child => {
    if (!child.isSkinnedMesh) return
    const sourceBones = child.skeleton.bones
    const bones = sourceBones.map(resolveBone)
    const missing = sourceBones.find((bone, index) => !bones[index]?.isBone)
    if (missing) throw new Error(`${source.name} is missing cloned bone ${missing.name}`)
    const skeleton = new Skeleton(bones, child.skeleton.boneInverses.map(matrix => matrix.clone()))
    child.bind(skeleton, child.bindMatrix.clone())
  })
  return clone
}

export function clonePlacedUnitFigure(source, type, detail = 'high') {
  const figure = cloneSkinnedFigure(placedUnitFigure(source, type, detail))
  figure.userData.unitTemplateType ||= type
  if (type === 'soldier') normalizeSoldierAttributes(figure)
  return figure
}

function normalizeSoldierAttributes(object) {
  object.traverse(child => {
    const geometry = child.geometry
    const legacy = geometry?.getAttribute?.('_soldiersurface')
    if (legacy && !geometry.getAttribute('soldierSurface')) geometry.setAttribute('soldierSurface', legacy)
  })
}
