import {retainResourcesDuring} from './retained-reparent.js'
/** Retain a stopped-only source and its GPU allocations outside Play traversal. */
export function detachAuthoredRoot(node, manager) {
  const parent = node.parent, siblings = parent?.children.slice()
  retainResourcesDuring(manager,()=>node.removeFromParent())
  let restored = false
  return {
    restore() {
      if (restored) return
      restored = true
      if (!parent) return
      parent.add(node)
      const additions = parent.children.filter(child => !siblings.includes(child))
      const retained = siblings.filter(child => child.parent === parent)
      parent.children.splice(0, parent.children.length, ...retained, ...additions)
    },
  }
}
