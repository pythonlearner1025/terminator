import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {removeEventListener(){}}
const E=await import('threepipe')
const {UnitView}=await import('../../lib/view/units.js')

test('a recycled rig stops scene matrix traversal, reactivates without allocation, and leaves with its runtime root',()=>{
 const scene=new E.Group(),root=new E.Group();scene.add(root)
 const view=new UnitView({removeEventListener(){}})
 view.root=root;view.dormantRoot=new E.Group();view.templates={endo:new E.Group()};view.visualPool={endo:[]}
 const material=new E.MeshBasicMaterial(),geometry=new E.BoxGeometry(),object=new E.Group(),bone=new E.Bone()
 const mesh=new E.Mesh(geometry,material);object.add(bone,mesh);root.add(object)
 const pose=bone.position.clone(),quat=bone.quaternion.clone(),scale=bone.scale.clone()
 const rig={targets:{},flinches:{},severed:new Set(),states:new Set(),previous:new E.Vector3(),feet:{Left:{},Right:{}},
   mesh,highGeometry:geometry,wreckMaterial:material,ragdollBounds:new E.Sphere(),eyes:new E.Group()}
 const visual={object,rig,restPose:[{node:bone,position:pose,quaternion:quat,scale}],unitId:'old',unitType:'endo',
   impact:{direction:new E.Vector3(),point:new E.Vector3()}}
 view.materials={metal:material};view.fx={release(){},gore:{resetVisual(){}},dispose(){}}
 let updates=0;const update=bone.updateMatrixWorld
 bone.updateMatrixWorld=function(...args){updates++;return update.apply(this,args)}
 view.visuals.set('old',visual);scene.updateMatrixWorld(true);assert(updates>0)
 view.recycleVisual('old',visual,'endo');updates=0;scene.updateMatrixWorld(true)
 assert.equal(updates,0);assert.equal(view.visuals.size,0);assert.equal(object.visible,false)
 bone.position.set(6,7,8)
 const reused=view.cloneTemplateFigure({id:'new',type:'endo',pos:{x:2,y:3,z:4},yaw:.7})
 assert.equal(reused,visual);assert.equal(object.parent,root);assert.equal(object.visible,true)
 assert.deepEqual(bone.position.toArray(),pose.toArray());assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material)
 scene.updateMatrixWorld(true);assert(updates>0);assert.deepEqual(object.position.toArray(),[2,3,4])
 view.visuals.set('new',visual);view.recycleVisual('new',visual,'endo')
 const template=new E.Group();view.dormantRoot.add(template);view.runtimeTemplates={endo:template}
 view.stop();view.stop();assert.equal(root.parent,null);assert.equal(view.dormantRoot,null)
 geometry.dispose();material.dispose()
})
