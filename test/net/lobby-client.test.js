import test from 'node:test'
import assert from 'node:assert/strict'
import {LobbyClient,configuredServerUrl} from '../../lib/net/lobby-client.js'

test('only loopback pages default to the local Skynet server',()=>{
 for(const host of ['localhost','localhost.','127.0.0.1','127.1.2.3','[::1]']) {
  assert.equal(configuredServerUrl(new URL(`http://${host}:4321/`),''),'http://localhost:7801')
 }
 for(const host of ['terminator.app.blitz.dev','192.168.1.20','localhost.example.com','example.com']) {
  assert.equal(configuredServerUrl(new URL(`https://${host}/`),''),'')
 }
 assert.equal(configuredServerUrl(null,''),'')
})

test('explicit external agents retain query, global and constructor precedence',()=>{
 const page=new URL('https://terminator.app.blitz.dev/?skynetServer=https%3A%2F%2Fagent.example%2Fprefix&partyRelay=wss%3A%2F%2Fparty.example')
 assert.equal(configuredServerUrl(page,'https://global.example'),'https://agent.example/prefix')
 assert.equal(configuredServerUrl(new URL('https://terminator.app.blitz.dev/?partyRelay=wss://party.example'),'https://global.example'),'https://global.example')
 assert.equal(new LobbyClient({serverUrl:'https://explicit.example/prefix/'}).serverUrl,'https://explicit.example/prefix')
 assert.equal(configuredServerUrl(new URL('https://terminator.app.blitz.dev/?partyRelay=wss://party.example'),''),'','party relay does not enable a Skynet probe')
})

function fixture(t,serverUrl='') {
 const starts=[]
 const director={phase:'lobby',start(config){starts.push(config);this.phase='wave'},beginWave(){}}
 const world={skynet:{name:'OLD',connected:true},eventLog:[]}
 const lobby=new LobbyClient({world,director,serverUrl:'https://fixture.example'})
 lobby.serverUrl=serverUrl
 lobby.showLobby=()=>{}
 t.after(()=>lobby.stop())
 return {lobby,director,world,starts}
}

test('unconfigured public lobby starts built-in Skynet without any network request',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const {lobby,director,world,starts}=fixture(t)
 const requests=t.mock.method(globalThis,'fetch',()=>{throw Error('unexpected network probe')})
 lobby.start()
 const config={difficulty:'hard'}
 assert.deepEqual(director.start(config),{ok:true,pending:true})
 t.mock.timers.tick(350)
 assert.deepEqual(starts,[config])
 assert.equal(world.skynet.name,'BUILT-IN')
 assert.equal(world.skynet.connected,false)
 assert.equal(requests.mock.callCount(),0)
 assert.equal(lobby.baseUrl,null)
})

for(const failure of ['network','http'])test(`explicit server ${failure} failure falls back without blocking Start`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const {lobby,director,world,starts}=fixture(t,'https://agent.example/prefix')
 const requests=[]
 t.mock.method(globalThis,'fetch',async url=>{
  requests.push(url)
  if(failure==='network')throw new TypeError('Failed to fetch')
  return new Response('',{status:503})
 })
 lobby.start()
 director.start({difficulty:'normal'})
 await new Promise(resolve=>setImmediate(resolve))
 t.mock.timers.tick(350)
 assert.deepEqual(requests,['https://agent.example/prefix/api/lobby'])
 assert.deepEqual(starts,[{difficulty:'normal'}])
 assert.equal(world.skynet.connected,false)
 assert.equal(lobby.controllers.size,0)
})

test('stopping a failed connection cancels pending fallback Start',async t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const {lobby,starts}=fixture(t,'https://agent.example')
 t.mock.method(globalThis,'fetch',async()=>{throw Error('offline')})
 lobby.start()
 await new Promise(resolve=>setImmediate(resolve))
 lobby.stop()
 t.mock.timers.tick(1000)
 assert.deepEqual(starts,[])
})

test('explicit remote server still creates a lobby and fetches its first agent plan',async t=>{
 const {lobby}=fixture(t,'https://agent.example/prefix')
 const requests=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests.push([url,options])
  return Response.json(requests.length===1?{code:'ABC123',game_token:'test-token'}:{wave:1,agent_name:'Remote Agent'})
 })
 lobby.renderConnectedLobby=()=>{}
 lobby.pollState=()=>{}
 lobby.start()
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(lobby.baseUrl,'https://agent.example/prefix/api/lobby/ABC123')
 assert.equal(requests[0][1].method,'POST')
 assert.equal(requests[1][0],'https://agent.example/prefix/api/lobby/ABC123/game/plan/1')
 assert.equal(requests[1][1].headers['X-Game-Token'],'test-token')
 assert.equal(lobby.pendingPlan.agent_name,'Remote Agent')
})
