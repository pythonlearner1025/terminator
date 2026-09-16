import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
const blender=process.env.BLENDER||(existsSync('/snap/bin/blender')?'/snap/bin/blender':'blender')
for(const [cmd,args] of [['python3',['tools/blender/swingout/atlas.py']],[blender,['-b','-t','6','-P','tools/blender/swingout/build.py']],['node',['tools/blender/swingout/register.mjs']]]){
 const p=spawnSync(cmd,args,{stdio:'inherit'});if(p.error)throw p.error;if(p.status!==0)process.exit(p.status||1)
}
