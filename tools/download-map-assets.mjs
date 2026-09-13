// Re-fetch only the CC0 source assets. The texture builder creates derivatives.
import {mkdir, writeFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec = promisify(execFile)
const rows = []
await mkdir('assets/textures/map', {recursive: true})
await mkdir('assets/hdri', {recursive: true})
const jobs = []
for (const asset of ['concrete_wall_007', 'asphalt_02', 'rusty_metal_02']) {
  for (const map of ['diff', 'nor_gl', 'arm']) {
    const name = `${asset}_${map}_1k.jpg`
    jobs.push({file: `assets/textures/map/${name}`, url: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${asset}/${name}`, source: `https://polyhaven.com/a/${asset}`})
  }
}
const sky = 'qwantani_moon_noon_puresky'
jobs.push({file: `assets/hdri/${sky}_2k.hdr`, url: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${sky}_2k.hdr`, source: `https://polyhaven.com/a/${sky}`})
for (let i = 0; i < jobs.length; i += 3) {
  await Promise.all(jobs.slice(i, i + 3).map(async job => {
    await exec('curl', ['-fLsS', '--retry', '2', job.url, '-o', job.file])
    console.log(job.file)
  }))
}
await writeFile('assets/textures/map/sources.json', JSON.stringify(jobs, null, 2) + '\n')
