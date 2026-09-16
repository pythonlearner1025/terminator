// Deterministic gallery from supplied captures. No renders are generated or inferred.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname,relative} from 'node:path'
const manifest=resolve(process.argv[2]),output=resolve(process.argv[3]||'tools/blender/revolver-rebuild/generated/review/index.html')
const data=JSON.parse(await readFile(manifest,'utf8'))
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const embedded=new Map()
if(process.argv.includes('--embed')){
 const paths=[...(data.comparisons||[]).flatMap(c=>[c.reference,c.rebuild]),...(data.actions||[]).map(a=>a.image)].filter(Boolean)
 for(const path of new Set(paths)){
  const bytes=await readFile(resolve(dirname(manifest),path)),mime=/\.jpe?g$/i.test(path)?'image/jpeg':'image/png'
  embedded.set(path,`data:${mime};base64,${bytes.toString('base64')}`)
 }
}
const src=p=>embedded.get(p)||esc(relative(dirname(output),resolve(dirname(manifest),p)).split('/').map(encodeURIComponent).join('/'))
const fig=(p,label)=>p?`<figure><img src="${src(p)}" width="640" height="480" loading="lazy"><figcaption>${esc(label)}</figcaption></figure>`:`<figure class="missing">Missing capture: ${esc(label)}</figure>`
const pairs=(data.comparisons||[]).map(c=>`<section><h2>${esc(c.view)}</h2><div class="pair">${fig(c.reference,'Reference')}${fig(c.rebuild,'New Gun')}</div></section>`).join('')
const actions=(data.actions||[]).map(a=>`<section><h2>${esc(a.clip)} · ${esc(a.seconds)} s · ${esc(a.phase||'')}</h2>${fig(a.image,a.note||'Unreviewed capture')}</section>`).join('')
await writeFile(output,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Revolver rebuild review</title><style>body{background:#15191e;color:#e4e8ef;font:16px system-ui;margin:24px;max-width:1400px}h1,h2{font-weight:500}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0 0 24px}img{width:100%;height:auto;background:#252b34}figcaption{padding:8px}.missing{padding:80px;background:#402c26}p{max-width:900px}</style><h1>Revolver rebuild review</h1><p>${esc(data.notes||'Fixed cameras and capture parameters must match within each comparison. No quality score is inferred from this gallery.')}</p>${pairs}<h1>Action / contact samples</h1>${actions}</html>`)
console.log(output)
