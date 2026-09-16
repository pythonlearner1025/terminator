// Offline artifact checks; no browser, model edits or network.
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {digest} from '../qa/export-contract.mjs'
const out=resolve(process.argv[2]||'tools/blender/revolver-rebuild/generated/animation-videos')
const manifest=JSON.parse(await readFile(`${out}/capture-manifest.json`,'utf8'))
for(const line of (await readFile(`${out}/SHA256SUMS`,'utf8')).trim().split('\n')){
  const [hash,file]=line.split('  ');assert.equal(digest(await readFile(`${out}/${file}`)),hash,file)
}
const checks={sha256Files:true,decoded:[],motion:[],gallery:{},sourceHashesUnchanged:true}
for(const clip of [...manifest.clips,manifest.reel]){
  // Full decode exercises every encoded frame. Only these own sequential jobs run.
  execFileSync('ffmpeg',['-v','error','-threads','2','-i',`${out}/${clip.file}`,'-f','null','-'],{stdio:'pipe'})
  checks.decoded.push(clip.file)
  if(!clip.name)continue
  const evidence=JSON.parse(await readFile(`${out}/${clip.evidence}`,'utf8'))
  assert.equal(evidence.resources['memory.max'],'1887436800')
  assert.equal(evidence.resources['memory.high'],'1677721600')
  assert.equal(evidence.uniquePoseHashes>2,true)
  assert.equal(evidence.frames[0].sampledSeconds,0)
  assert.equal(evidence.frames.at(-1).sampledSeconds,evidence.authoredDuration)
  assert.equal(evidence.frames.length,clip.frameCount)
  for(const [file,hash] of Object.entries(evidence.sourceFileHashes))assert.equal(digest(await readFile(file)),hash,file)
  const pixels=execFileSync('ffmpeg',['-v','error','-threads','2','-filter_threads','2','-i',`${out}/${clip.file}`,'-vf','scale=160:120,format=gray','-f','rawvideo','-'],{maxBuffer:4*1024*1024})
  const size=160*120;assert.equal(pixels.length/size,clip.frameCount)
  const deltas=[]
  for(let frame=16;frame<clip.frameCount-15;frame++){
    let sum=0,count=0
    // Weapon/arms region, excluding the composited title and neutral upper field.
    for(let y=55;y<120;y++)for(let x=40;x<160;x++){const p=y*160+x;sum+=Math.abs(pixels[frame*size+p]-pixels[(frame-1)*size+p]);count++}
    deltas.push(sum/count)
  }
  assert.ok(Math.max(...deltas)>.001,'No decoded motion: '+clip.name)
  checks.motion.push({clip:clip.name,uniqueSourcePoses:evidence.uniquePoseHashes,uniqueRenderedPngs:evidence.uniqueFrameHashes,decodedActiveMeanAbsoluteDelta:deltas.reduce((a,b)=>a+b,0)/deltas.length,decodedActiveMaxAbsoluteDelta:Math.max(...deltas)})
}
const html=await readFile(`${out}/index.html`,'utf8')
assert.equal((html.match(/<video /g)||[]).length,10)
assert.equal((html.match(/<video[^>]*controls[^>]*preload="none"/g)||[]).length,10)
assert.equal((html.match(/class="rates"/g)||[]).length,10)
assert.equal((html.match(/download="[^"]+\.mp4"/g)||[]).length,10)
assert.equal((html.match(/<video[^>]*autoplay/g)||[]).length,0)
const embedded=[...html.matchAll(/<video[^>]*src="data:video\/mp4;base64,([^"]+)"/g)]
for(let i=0;i<embedded.length;i++)assert.equal(digest(Buffer.from(embedded[i][1],'base64')),digest(await readFile(`${out}/${[manifest.reel,...manifest.clips][i].file}`)))
// Execute the real inline handlers against small event targets. No extra browser.
const buttons=[],videos=[]
class Target{
  constructor(dataset={}){this.dataset=dataset;this.events={};this.attrs={}}
  addEventListener(name,fn){(this.events[name]||=[]).push(fn)}
  emit(name){for(const fn of this.events[name]||[])fn()}
  setAttribute(k,v){this.attrs[k]=v}
  pause(){this.paused=true;this.emit('pause')}
  play(){this.paused=false;this.emit('play');return Promise.resolve()}
}
for(const clip of ['reel',...manifest.clips.map(c=>c.name)]){
  const v=new Target();Object.assign(v,{id:`v-${clip}`,paused:true,currentTime:0,playbackRate:1,readyState:1});videos.push(v)
  const play=new Target({play:v.id}),restart=new Target({restart:v.id});buttons.push(play,restart)
  const group={children:[]};for(const rate of [.25,.5,1]){const b=new Target({video:v.id,rate:String(rate)});b.parentElement=group;group.children.push(b);buttons.push(b)}
}
const chapters=manifest.clips.map(c=>new Target({chapter:String(c.reelStart)}));buttons.push(...chapters)
const doc=new Target();doc.hidden=false;doc.getElementById=id=>videos.find(v=>v.id===id)
doc.querySelectorAll=selector=>selector==='video'?videos:buttons.filter(b=>Object.hasOwn(b.dataset,selector.slice(6,-1)))
doc.querySelector=selector=>buttons.find(b=>b.dataset.play===selector.match(/data-play="([^"]+)"/)[1])
vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],{document:doc})
buttons.find(b=>b.dataset.play===videos[0].id).emit('click');assert.equal(videos[0].paused,false)
buttons.find(b=>b.dataset.play===videos[1].id).emit('click');assert.equal(videos[0].paused,true);assert.equal(videos[1].paused,false)
for(const rate of [.25,.5,1]){buttons.find(b=>b.dataset.video===videos[1].id&&b.dataset.rate===String(rate)).emit('click');assert.equal(videos[1].playbackRate,rate)}
buttons.find(b=>b.dataset.restart===videos[1].id).emit('click');assert.equal(videos[1].currentTime,0)
chapters[3].emit('click');assert.equal(videos[0].currentTime,manifest.clips[3].reelStart)
doc.hidden=true;doc.emit('visibilitychange');assert.ok(videos.every(v=>v.paused))
checks.gallery={tenEmbeddedVideosMatchFiles:true,tenDownloads:true,tenNativeControls:true,noAutoplay:true,pauseOthers:true,allThreeSpeeds:true,restart:true,chapters:true,backgroundPause:true,inlineHandlersExecuted:true,visualBrowserTest:false}
await writeFile(`${out}/verification.json`,JSON.stringify(checks,null,2)+'\n')
for(const file of ['verification.json','evidence/motion-contact-sheet.jpg']){
  const bytes=await readFile(`${out}/${file}`).catch(()=>null);if(!bytes)continue
  manifest.outputs=manifest.outputs.filter(item=>item.file!==file)
  manifest.outputs.push({file,bytes:bytes.length,sha256:digest(bytes)})
}
manifest.captureScriptHashes={}
for(const name of await readdir('tools/blender/revolver-rebuild/video')){
  const file=`tools/blender/revolver-rebuild/video/${name}`
  manifest.captureScriptHashes[file]=digest(await readFile(file))
}
await writeFile(`${out}/capture-manifest.json`,JSON.stringify(manifest,null,2)+'\n')
await writeFile(`${out}/SHA256SUMS`,[...manifest.outputs.map(f=>`${f.sha256}  ${f.file}`),`${digest(await readFile(`${out}/capture-manifest.json`))}  capture-manifest.json`].join('\n')+'\n')
console.log(JSON.stringify(checks,null,2))
