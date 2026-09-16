// Run the complete headless asset build. All outputs are new HD candidates.
import {spawnSync} from 'node:child_process'
const round=String(Number(process.argv[2]||6))
if(!/^[1-6]$/.test(round))throw Error('Choose round 1 through 6')
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1)}
for(const script of ['build','surface'])run('/snap/bin/blender',['-b','--python-exit-code','1','-P',`tools/blender/hd/${script}.py`,'--',round])
run('python3',['tools/blender/hd/finish.py',round])
run('/snap/bin/blender',['-b','--python-exit-code','1','-P','tools/blender/hd/export.py','--',round])
run('node',['tools/blender/hd/register.mjs'])
run('npm',['run','scene'])
