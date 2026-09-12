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
  const joints = new Map()
  clone.traverse(child => {
    if (typeof child.userData.name === 'string') child.name = child.userData.name
    if (child.isBone) joints.set(child.name.replaceAll('_', ' '), child)
  })
  clone.traverse(child => {
    if (!child.isSkinnedMesh) return
    const names = child.skeleton.bones.map(bone => bone.name.replaceAll('_', ' '))
    const bones = names.map(name => joints.get(name))
    const missing = names.find((name, index) => !bones[index])
    if (missing) throw new Error(`${source.name} is missing cloned bone ${missing}`)
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
