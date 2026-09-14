/** Temporary per-viewer diagnostic only. This is not the production installer. */
export function installTransparencyDiagnostic(viewer) {
 const material=viewer.renderManager?.renderPass?._blendPass?.material
 const stock='c = vec4(a.rgb * (1. - b.a) + b.rgb * b.a, 1.);'
 const corrected='c = vec4(a.rgb * (1. - b.a) + b.rgb, 1.);'
 const original=material?.fragmentShader
 if(!original||original.split(stock).length!==2)throw Error('Unsupported transparent compositor diagnostic layout')
 const patched=original.replace(stock,corrected)
 material.fragmentShader=patched;material.needsUpdate=true
 let disposed=false
 return {equation:corrected,dispose(){if(disposed)return;disposed=true;if(material.fragmentShader!==patched)throw Error('Diagnostic compositor changed unexpectedly');material.fragmentShader=original;material.needsUpdate=true}}
}
