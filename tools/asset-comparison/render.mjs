import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('.');
const server=createServer(async(req,res)=>{try{let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/kite3d\//,'/');const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error('Invalid path');const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json','.png':'image/png','.jpg':'image/jpeg'})[extname(file)]||'application/octet-stream');res.end(data)}catch{res.statusCode=404;res.end('Not found')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const scene=JSON.parse(await readFile('assets/main.scene.gltf','utf8'));const index=JSON.parse(await readFile('assets.json','utf8')).files;
const rows=[];for(const n of scene.nodes){const ref=n.extras?.rootPath;if(!ref)continue;const id=ref.match(/@([^/]+)/)[1];let row=rows.find(r=>r.id===id);if(!row){row={id,path:index[id].path,names:[],image:`images/original-${id}.png`};rows.push(row)}row.names.push(n.name)}
await mkdir('docs/asset-comparison/images',{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal']});
try{const page=await browser.newPage({viewport:{width:640,height:400}});page.on('pageerror',e=>console.error(e.message));await page.goto(origin+'/tools/asset-comparison/render.html');await page.waitForFunction(()=>window.ready,{timeout:60000});
for(const [i,row] of rows.entries()){row.render=await page.evaluate(path=>window.renderAsset(path),row.path);await page.screenshot({path:'docs/asset-comparison/'+row.image});if(i%10===0)console.log(`Rendered ${i+1}/${rows.length}: ${row.id}`)}
await writeFile('docs/asset-comparison/inventory.json',JSON.stringify(rows,null,2));console.log(`Rendered all ${rows.length} originals`);
}finally{await browser.close();server.close()}
