// Batch static children in an animated local frame. Signals, lids, arcs and lights retain identity.
export function batchLocalMeshes(api, root, protectedNodes = new Set()) {
  root.updateWorldMatrix(true, true)
  const inverse = root.matrixWorld.clone().invert(), batches = new Map()
  function collect(node) {
    for (const child of [...node.children]) {
      if (protectedNodes.has(child) || child.isPoints || child.isLight || child.isLine) continue
      if (!child.isMesh) { collect(child); continue }
      if (child.material.transparent) continue
      const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone())
      geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld))
      if (!batches.has(child.material)) batches.set(child.material, [])
      batches.get(child.material).push(geometry)
      child.geometry.dispose(); child.removeFromParent()
    }
  }
  collect(root)
  for (const [material, geometries] of batches) {
    const geometry = api.mergeGeometries(geometries, false)
    for (const part of geometries) part.dispose()
    if (!geometry) throw new Error(`Cannot batch ${root.name}: ${material.name}`)
    const mesh = new api.Mesh2(geometry, material)
    mesh.name = `${root.name} ${material.name}`
    mesh.castShadow = true; mesh.receiveShadow = true
    root.add(mesh)
  }
}

export function bevelMapBox(api, size) {
  const geometry = new api.BoxGeometry(...size, 2, 2, 2)
  const radius = Math.min(.035, Math.min(...size) * .08)
  const positions = geometry.attributes.position, normals = geometry.attributes.normal
  for (let i = 0; i < positions.count; i++) {
    const p = [positions.getX(i), positions.getY(i), positions.getZ(i)]
    const inset = p.map((v, axis) => Math.max(-size[axis] / 2 + radius, Math.min(size[axis] / 2 - radius, v)))
    const d = p.map((v, axis) => v - inset[axis]), length = Math.hypot(...d)
    const n = d.map(v => v / length)
    positions.setXYZ(i, ...inset.map((v, axis) => v + n[axis] * radius))
    normals.setXYZ(i, ...n)
  }
  return geometry
}

// Repeated shutter hardware shares geometry. Labels keep their unique atlas rectangles.
export function instanceMapHardware(api, parent, sources) {
  parent.updateWorldMatrix(true,true)
  const inverse=parent.matrixWorld.clone().invert(),matrix=new api.Matrix4(),byMaterial=new Map(),batches=[]
  for(const source of sources){
    if(!byMaterial.has(source.material))byMaterial.set(source.material,[])
    byMaterial.get(source.material).push(source)
  }
  for(const [material,meshes]of byMaterial){
    if(meshes.length<2)continue
    const first=meshes[0].geometry
    // Vertex counts alone cannot establish that two pieces have the same shape.
    if(meshes.some(mesh=>{
      const a=first.attributes.position.array,b=mesh.geometry.attributes.position.array
      return a.length!==b.length||a.some((value,index)=>Math.abs(value-b[index])>1e-6)
    }))continue
    const instance=new api.InstancedMesh2(first.clone(),material,meshes.length)
    instance.name='Pooled '+material.name+' gate hardware'
    instance.castShadow=!material.transparent;instance.receiveShadow=true
    parent.add(instance)
    for(const mesh of meshes)mesh.visible=false
    batches.push({instance,meshes})
  }
  function sync(){
    for(const {instance,meshes}of batches){
      for(let i=0;i<meshes.length;i++){
        meshes[i].updateWorldMatrix(true,false)
        matrix.multiplyMatrices(inverse,meshes[i].matrixWorld)
        instance.setMatrixAt(i,matrix)
      }
      instance.instanceMatrix.needsUpdate=true
    }
  }
  sync()
  for(const {instance}of batches)instance.computeBoundingSphere()
  return {batches,sync}
}

// Preserve each surface's PBR factors while sharing one draw for a texture family.
export function mapMaterialBatcher(api) {
  const materials=new Map()
  return (source,geometry)=>{
    const family=source.userData.mapBatchFamily
    if(!family)return source
    let material=materials.get(family)
    if(!material){
      material=source.clone();material.name='Map batched '+family;material.color.setHex(0xffffff)
      material.vertexColors=true;material.metalness=1;material.roughness=1
      const compile=source.onBeforeCompile,cacheKey=source.customProgramCacheKey
      material.onBeforeCompile=function(shader,renderer){
        compile.call(this,shader,renderer)
        shader.vertexShader='attribute vec2 mapSurfaceFactors; varying vec2 vMapSurfaceFactors;\n'+shader.vertexShader
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvMapSurfaceFactors=mapSurfaceFactors;')
        shader.fragmentShader='varying vec2 vMapSurfaceFactors;\n'+shader.fragmentShader
        shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor*=vMapSurfaceFactors.x;')
        shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor*=vMapSurfaceFactors.y;')
      }
      material.customProgramCacheKey=function(){return cacheKey.call(this)+':map-family-'+family}
      materials.set(family,material)
    }
    const count=geometry.attributes.position.count,colors=new Float32Array(count*3),factors=new Float32Array(count*2)
    for(let i=0;i<count;i++){
      colors[i*3]=source.color.r;colors[i*3+1]=source.color.g;colors[i*3+2]=source.color.b
      factors[i*2]=source.roughness;factors[i*2+1]=source.metalness
    }
    geometry.setAttribute('color',new api.BufferAttribute(colors,3))
    geometry.setAttribute('mapSurfaceFactors',new api.BufferAttribute(factors,2))
    return material
  }
}

export function batchMapParticles(api, parent, sources, name) {
  const count=sources.reduce((sum,p)=>sum+p.geometry.attributes.position.count,0)
  const geometry=new api.BufferGeometry(),attribute=new api.Float32BufferAttribute(new Float32Array(count*3),3)
  geometry.setAttribute('position',attribute)
  const points=new api.Points(geometry,sources[0].material);points.name=name;points.frustumCulled=false
  const owned=new api.Group();owned.name=name+' source buffers';owned.visible=false
  for(const source of sources)owned.add(source)
  parent.add(owned,points)
  return {sync(){
    let offset=0
    for(const source of sources){
      const from=source.geometry.attributes.position,n=Math.min(from.count,source.geometry.drawRange.count)
      attribute.array.set(from.array.subarray(0,n*3),offset*3);offset+=n
    }
    attribute.needsUpdate=true;geometry.setDrawRange(0,offset)
  }}
}
