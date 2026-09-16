// three.js recomputes the world matrix of every node in the scene on every
// render pass, whether or not the node is visible. Play hides whole authored
// subtrees — the placed map, the unit sources, the environment preview — and
// renders its own runtime copies instead, so those subtrees can stop paying
// that cost until Play gives them back. These two calls do that, and they only
// work as a pair: a subtree sleeps only while every container above it is
// still. Both return the call that undoes them.

// Hold a container that never moves. Object3D.updateMatrix always marks a node
// dirty, and a dirty node forces the update of its whole subtree whatever each
// child asked for. Two kinds of node qualify: the scene root, the imported
// model root and the authored map group, which Play replaces with runtime
// copies; and the runtime roots, which are empty groups at the origin holding
// the content that does move. Call it once the node has its final transform.
export function holdStill(nodes) {
  const held = []
  for (const node of nodes) {
    if (!node || node.matrixAutoUpdate === false) continue
    // updateMatrix leaves the node marked dirty, and a dirty node forces its
    // whole subtree again. Settle the world matrix here instead; the transform
    // does not change, so every descendant already holds the right one.
    node.updateMatrix()
    if (node.parent) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix)
    else node.matrixWorld.copy(node.matrix)
    node.matrixWorldNeedsUpdate = false
    node.matrixAutoUpdate = false
    held.push(node)
  }
  return function release() {
    for (const node of held) node.matrixAutoUpdate = true
    held.length = 0
  }
}

// Take a hidden subtree out of the walk. updateMatrixWorld skips a child whose
// matrixWorldAutoUpdate is false unless an ancestor moved this frame, so the
// subtree is passed over and left alone. An explicit updateMatrixWorld(force)
// on the node itself still descends, which is what every clone path here uses.
export function sleepSubtrees(nodes) {
  const asleep = []
  for (const node of nodes) {
    if (!node || node.matrixWorldAutoUpdate === false) continue
    node.matrixWorldAutoUpdate = false
    asleep.push(node)
  }
  // Waking forces one update, so a node whose parent moved while it slept holds
  // a correct world matrix before any reader sees it.
  return function wake() {
    for (const node of asleep) {
      node.matrixWorldAutoUpdate = true
      node.updateMatrixWorld(true)
    }
    asleep.length = 0
  }
}
