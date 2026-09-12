// Compatibility entry point retained for callers from phase one.
import {createUnitFigure} from './unit-template.generator.js'
import {createRosterFigure} from './roster-geometry.js'
export function createUnitPlaceholder(E,type,options={}) {
  return ['t1000','hkaerial','hktank'].includes(type)?createRosterFigure(E,type,options):createUnitFigure(E,type,options)
}
export function applyUnitPlaceholderMaterial() {}
