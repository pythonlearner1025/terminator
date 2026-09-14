// Several startup stages can overlap. Resume the viewer only after the last
// owner releases its lease, preserving a viewer that was already suspended.
const holds = new WeakMap()
export function holdStartupRendering(viewer) {
  let state = holds.get(viewer)
  if (!state) {state = {count:0, enabled:viewer.renderEnabled}; holds.set(viewer,state); viewer.renderEnabled=false}
  state.count++
  let released=false
  return () => {
    if(released)return
    released=true
    if(--state.count)return
    holds.delete(viewer)
    viewer.renderEnabled=state.enabled
    viewer.setDirty?.()
  }
}

// The editor inserts an opaque Play canvas before awaiting its own initial
// scene readiness. Avoid uploading/rendering the now-covered authoring scene
// during that wait. Its complete authored data still loads; normal editor
// rendering resumes when the overlay is removed (Stop or cancelled Play).
export function holdCoveredEditorRendering(viewer, Observer=globalThis.MutationObserver) {
  if(viewer.canvas?.classList?.contains('game-canvas-overlay'))return ()=>{}
  const container=viewer.canvas?.closest?.('.editorCanvasContainer')
  if(!container||!Observer)return ()=>{}
  let release,disposed=false
  const update=()=>{
    if(disposed)return
    const covered=Boolean(container.querySelector('.game-canvas-overlay'))
    if(covered&&!release){release=holdStartupRendering(viewer);globalThis.performance?.mark?.('terminator:editor-covered')}
    else if(!covered&&release){release();release=null;globalThis.performance?.mark?.('terminator:editor-uncovered')}
  }
  const observer=new Observer(update)
  observer.observe(container,{childList:true})
  update()
  return ()=>{if(disposed)return;disposed=true;observer.disconnect();release?.();release=null}
}
