import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const here=dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2)
const wrapper=process.env.REVOLVER_BLENDER||'/home/minjune/games/terminator-v2/coordination/revolver-blender'
if(!existsSync(wrapper))throw Error('Set REVOLVER_BLENDER to the approved serialized Blender wrapper for this machine. Direct unbounded Blender execution is not used.')
const result=spawnSync(wrapper,['-b','--python-exit-code','1','-P',resolve(here,'assemble.py'),'--',...args],{stdio:'inherit'})
if(result.error)throw result.error
if(result.status!==0)process.exit(result.status||1)
if(!args.includes('--preview')){
 const out=args.includes('--output')?resolve(args[args.indexOf('--output')+1]):resolve(here,'generated/assembled')
 const {verify}=await import('./verify.mjs'),report=await verify(resolve(out,'revolver-rebuild.gltf'))
 console.log(JSON.stringify({output:out,triangles:report.triangles,materials:report.materials,failures:report.failures,warnings:report.warnings},null,2))
 if(report.failures.length)process.exitCode=1
}
