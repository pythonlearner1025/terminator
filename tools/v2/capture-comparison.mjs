import {readFile,writeFile} from 'node:fs/promises'
import {resolve,relative,dirname} from 'node:path'
const candidate=resolve(process.argv[2]||'docs/evidence/v2-integration-01')
const target=resolve('docs/scene-targets/targets-v2')
const manifest=JSON.parse(await readFile(resolve(candidate,'capture.json'),'utf8'))
const output=resolve(candidate,'comparison.html')
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const url=file=>relative(dirname(output),file).split('/').map(encodeURIComponent).join('/')
await writeFile(output,`<!doctype html><meta charset="utf-8"><title>V2 actual runtime comparison</title>
<style>body{background:#090e16;color:#d2dfed;font:16px system-ui;margin:24px}section{margin:30px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{padding:8px 0}code{font-size:12px}h1{font-size:24px}</style>
<h1>Actual Linux runtime (left) / selected V2 target (right)</h1><p>Five original player POVs, 72° FOV. No image registration or crop. Targets fit the same aspect ratio.</p><code>Commit ${escape(manifest.git)} · Chrome ${escape(manifest.browser)} · ${escape(manifest.views[0].renderer)}</code>
${manifest.diagnosticOverrides?`<p><strong>Diagnostic browser overrides; scene approval pending.</strong> Base checkout above, served module commits: ${manifest.diagnosticOverrides.modules.map(m=>`${escape(m.owner)} <code>${escape(m.commit)}</code>`).join(' · ')}.</p>`:''}
${manifest.views.map(v=>`<section><h2>${escape(v.id)}</h2><div class="pair"><figure><img src="${url(resolve(candidate,v.id+'.png'))}"><figcaption>Current capture · rAF cadence median ${v.performance.medianMs.toFixed(1)} ms / p95 ${v.performance.p95Ms.toFixed(1)} ms</figcaption></figure><figure><img src="${url(resolve(target,v.id+'.png'))}"><figcaption>Selected V2 target</figcaption></figure></div></section>`).join('\n')}`)
console.log(output)
