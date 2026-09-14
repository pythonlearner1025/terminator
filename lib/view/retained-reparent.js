// Object3DManager unregisters descendants synchronously on reparenting and, by
// default, disposes their last-use GPU resources. Runtime pools retain ownership
// until Stop: suppress only that synchronous disposal, restoring every setting.
const flags=['autoDisposeObjects','autoDisposeGeometries','autoDisposeMaterials','autoDisposeTextures']
export function retainResourcesDuring(manager, work) {
 if(!manager)return work()
 const saved=flags.map(key=>manager[key])
 for(const key of flags)manager[key]=false
 try{return work()}
 finally{for(let i=0;i<flags.length;i++)manager[flags[i]]=saved[i]}
}
