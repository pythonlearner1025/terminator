import test from 'node:test'
import assert from 'node:assert/strict'
import {parsePartyInvite, partyErrorMessage, partyPlayers, PartySession} from '../../../lib/ui/party.js'
import {scoreboardSnapshot} from '../../../lib/ui/presentation.js'

test('invite parsing preserves the remote relay, normalizes codes, and rejects unsafe relay schemes',()=>{
  assert.deepEqual(parsePartyInvite('https://game.example/?party=abc123&relay=https%3A%2F%2Frelay.example'),{code:'ABC123',relay:'wss://relay.example'})
  assert.deepEqual(parsePartyInvite(' abc123 ','ws://192.168.1.42:7801/'),{code:'ABC123',relay:'ws://192.168.1.42:7801'})
  assert.throws(()=>parsePartyInvite('AB!'),/Bad party code/)
  assert.throws(()=>parsePartyInvite('ABC123','javascript:alert(1)'),/Invalid relay/)
  assert.throws(()=>parsePartyInvite('ABC123','wss://user:secret@relay.example'),/Invalid relay/)
})
test('party errors distinguish unavailable relay, full room, and host departure',()=>{
  assert.deepEqual(partyPlayers(null),[])
  assert.match(partyErrorMessage(new Error('party relay connection failed')),/Relay unreachable/)
  assert.match(partyErrorMessage(new Error('party is full')),/Party full/)
  assert.match(partyErrorMessage(new Error('The host left the party.')),/Host left/)
})
test('late connection results cannot reopen a party after leaving or disposing',async()=>{
  let resolve,leaves=0,updates=[]
  const manager={startHost:()=>new Promise(done=>{resolve=done}),leaveParty:()=>{leaves++}}
  const session=new PartySession(manager,state=>updates.push(state))
  const pending=session.connect('host',{name:'Sarah'})
  session.leave()
  resolve({code:'ABC123',players:[]})
  await pending
  assert.equal(session.state,null)
  assert.equal(leaves,1)
  assert.equal(updates.length,1)
  session.dispose();session.receive({status:'playing'})
  assert.equal(updates.length,1)
})
test('host start respects ready marks and explicit override',async()=>{
  let starts=0
  const session=new PartySession({startMatch:()=>{starts++;return {ok:true}}},()=>{})
  session.state={role:'host',players:[{id:'host',ready:true},{id:'guest',ready:false}]}
  assert.equal(await session.start(false),false)
  assert.equal(starts,0)
  assert.equal(await session.start(true),true)
  session.state.role='guest'
  assert.equal(await session.start(true),false)
  assert.equal(starts,1)
})
test('scoreboard counts the entire match and never credits enemy shots to their target',()=>{
  const world={players:new Map([['player',{id:'player',name:'Sarah',scrap:710}],['guest',{id:'guest',name:'Kyle',scrap:300}]]),eventLog:[
    {type:'player_join',playerId:'left',name:'Blair'},
    {type:'shot',by:'left',playerId:'left',hit:true},
    {type:'unit_damage',playerId:'left',amount:42},
    {type:'player_leave',playerId:'left',name:'Blair'},
    {type:'shot',by:'player',playerId:'player',hit:true,wave:1},
    {type:'shot',by:'player',playerId:'player',hit:false,wave:2},
    {type:'shot',by:'enemy-1',playerId:'player',hit:true},
    {type:'unit_damage',playerId:'player',amount:18.5,wave:1},
    {type:'unit_damage',playerId:'player',amount:21.5,wave:2},
    {type:'kill',playerId:'player',unitType:'scout'},
  ]}
  const [sarah,kyle,blair]=scoreboardSnapshot(world)
  assert.equal(sarah.accuracy,50);assert.equal(sarah.damage,40);assert.equal(sarah.kills,1);assert.equal(sarah.scrap,710)
  assert.equal(kyle.accuracy,0)
  assert.equal(blair.damage,42);assert.equal(blair.accuracy,100);assert.equal(blair.connected,false);assert.equal(blair.scrap,null)
})
