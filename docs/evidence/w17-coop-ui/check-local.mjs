import {mkdtemp,symlink,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

// Other agents have their own servers and overwrite the shared dev.json. Give
// the CLI an isolated connection file pointing at 4595, and the same source via
// symlinks, so check never sends a stop/check command to another editor.
const root=new URL('../../../',import.meta.url).pathname
const log=await readFile('/tmp/terminator-w17-dev.log','utf8')
const url=log.match(/http:\/\/[^\s]+\?t=[^\s]+/)?.[0]
if(!url || new URL(url).port!=='4595')throw Error('Own development server is not running on port 4595')
const directory=await mkdtemp(join(tmpdir(),'terminator-w17-check-'))
try{
  for(const path of ['package.json','assets.json','main.js','assets','generators','scripts','lib','node_modules'])await symlink(join(root,path),join(directory,path))
  await mkdir(join(directory,'.kite3d'))
  await writeFile(join(directory,'.kite3d/dev.json'),JSON.stringify({url,origin:new URL(url).origin,token:new URL(url).searchParams.get('t')}),{mode:0o600})
  let result
  try{result=await promisify(execFile)('npx',['kite3d','check'],{cwd:directory,timeout:120000,maxBuffer:2**20})}
  catch(error){result={stdout:error.stdout || '',stderr:error.stderr || ''};process.exitCode=1}
  const report=JSON.parse(await readFile(join(directory,'.kite3d/check.json'),'utf8'))
  await writeFile(new URL('kite3d-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
  console.log(result.stdout.replace(/([?&]t=)[^&\s]+/g,'$1[redacted]'))
  console.log(JSON.stringify({ok:report.ok,outcomes:report.outcomes.map(({name,status,summary})=>({name,status,summary}))},null,2))
}finally{await rm(directory,{recursive:true,force:true})}
