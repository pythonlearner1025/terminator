import assert from 'node:assert/strict'
import {readFile,writeFile,access} from 'node:fs/promises'
import {resolve,relative} from 'node:path'
const before=resolve(process.argv[2]),candidate=resolve(process.argv[3])
const a=JSON.parse(await readFile(before+'/capture.json','utf8')),b=JSON.parse(await readFile(candidate+'/capture.json','utf8'))
const output=candidate+'/before-target-latest.html'
await access(output).then(()=>{throw Error('Refusing to overwrite pair comparison')},e=>{if(e.code!=='ENOENT')throw e})
for(const v of b.views){const old=a.views.find(o=>o.id===v.id);assert(old);for(const k of ['camera','feet','support','tick','mapState','weapon','renderSettings','renderer'])assert.deepEqual(v[k],old[k],`${v.id} ${k}`)}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const url=p=>relative(candidate,p).split('/').map(encodeURIComponent).join('/')
await writeFile(output,`<!doctype html><meta charset="utf-8"><title>V2 declared-cover pair review</title>
<style>body{background:#090e16;color:#d2dfed;font:16px system-ui;margin:24px}.row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}figure{margin:0}img{display:block;width:100%}figcaption{padding:8px 0}section{margin:28px 0}code{overflow-wrap:anywhere}</style>
<h1>Before | New target | Latest progress</h1><p>Declared scan-cover candidate. Native images; original camera/HUD/settings. Review requested; no gallery promotion or scene approval.</p>
<p>Before source <code>${esc(a.git)}</code><br>Latest source <code>${esc(b.git)}</code></p>
${b.views.map(v=>`<section><h2>${esc(v.id)}</h2><div class="row">${[[before,'Before: milestone 16'],[resolve('docs/scene-targets/targets-v2'),'Selected V2 target'],[candidate,'Latest: declared scan piles']].map(([p,label])=>`<figure><a href="${url(p+'/'+v.id+'.png')}"><img src="${url(p+'/'+v.id+'.png')}"></a><figcaption>${label}</figcaption></figure>`).join('')}</div></section>`).join('')}`)
console.log(output)
