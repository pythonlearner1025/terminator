// Deterministic self-contained image gallery with projected native-joint labels.
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {resolve,basename} from 'node:path'
const dir=resolve(process.argv[2]),files=(await readdir(dir)).filter(x=>x.endsWith('.png')).sort()
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
let cards=''
for(const file of files){
 let labels={};try{labels=JSON.parse(await readFile(resolve(dir,file.replace('.png','-labels.json')),'utf8'))}catch{}
 let overlay='',i=0
 for(const [name,[x,y]] of Object.entries(labels)){
  const color=['#50aaff','#ff8a28','#4aff70'][i++],labelY=22+i*23
  overlay+=`<path d="M${x},${y} L${460},${labelY-5}" stroke="${color}" fill="none"/><circle cx="${x}" cy="${y}" r="4" fill="${color}"/><text x="465" y="${labelY}" fill="${color}">${escape(name)}</text>`
 }
 const data=(await readFile(resolve(dir,file))).toString('base64')
 cards+=`<figure><figcaption>${escape(file)}</figcaption><div><img src="data:image/png;base64,${data}"><svg viewBox="0 0 640 480">${overlay}</svg></div></figure>`
}
await writeFile(resolve(dir,'review.html'),`<!doctype html><meta charset="utf-8"><title>Imported revolver grasp review</title><style>body{background:#222;color:#eee;font:16px system-ui;margin:24px}main{display:flex;flex-wrap:wrap}figure{margin:8px;width:640px}figure div{position:relative}img{width:100%}svg{position:absolute;inset:0;width:100%;height:100%;font:15px monospace;paint-order:stroke;stroke:#111;stroke-width:2px}figcaption{padding:8px}</style><h1>${escape(basename(dir))}</h1><p>Native distal-joint markers label digits; markers alone do not establish skin contact. Blue: right index. Orange: right thumb. Green: support thumb. Use contacts.json and bilateral.json alongside multi-angle images. No visual approval implied.</p><main>${cards}</main>`)
console.log(resolve(dir,'review.html'))
