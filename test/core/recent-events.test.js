import assert from 'node:assert/strict'
import test from 'node:test'
import {recentEventsFor} from '../../lib/core/recent-events.js'

function matchesFilter(world, now) {
  const expected = world.eventLog.filter((event) => now - event.t <= 5)
  const actual = recentEventsFor(world, now)
  assert.deepEqual(actual, expected)
  for (let index = 0; index < expected.length; index++) {
    assert.equal(actual[index], expected[index], 'retain original event identities and order')
  }
  return actual
}

test('recent events preserve inclusive subtraction, insertion order, future times and rewinds', () => {
  const world = {eventLog: [
    {id: 'future', t: 200}, {id: 'old', t: -10}, {id: 'edge', t: 5},
    {id: 'new', t: 10}, {id: 'outside', t: 4.999999999999999},
  ]}
  assert.deepEqual(matchesFilter(world, 10).map(e => e.id), ['future', 'edge', 'new'])
  assert.deepEqual(matchesFilter(world, 10.0001).map(e => e.id), ['future', 'new'])
  // An old timestamp appended after a future timestamp must not hide either.
  world.eventLog.push({id: 'late-old', t: 0}, {id: 'late-edge', t: 6})
  assert.deepEqual(matchesFilter(world, 11).map(e => e.id), ['future', 'new', 'late-edge'])
  matchesFilter(world, 206)
  assert.deepEqual(matchesFilter(world, -5).map(e => e.id), world.eventLog.map(e => e.id))
  for (const now of [-5, 0.1, 0.3, 4.999999999999999, 5, 10, 200, 205, 205.0001]) matchesFilter(world, now)
})

test('array replacement, observed shrink, and invisible truncate/reappend invalidate the projection', () => {
  const world = {eventLog: Array.from({length: 8}, (_, id) => ({id, t: id}))}
  matchesFilter(world, 10)
  world.eventLog = structuredClone(world.eventLog)
  matchesFilter(world, 10)
  world.eventLog.length = 3
  matchesFilter(world, 10)
  world.eventLog.push({id: 'restored', t: 10})
  matchesFilter(world, 10)
  for (const replacementLength of [2, 4, 7]) {
    const length = world.eventLog.length
    world.eventLog.length = 2
    world.eventLog.push(...Array.from({length: replacementLength}, (_, id) => ({id: `suffix-${id}`, t: 10})))
    assert.ok(world.eventLog.length >= length || replacementLength === 2)
    matchesFilter(world, 10)
  }
  world.eventLog.length = 0
  assert.deepEqual(matchesFilter(world, 10), [])
  world.eventLog.push({id: 'restart', t: 10})
  matchesFilter(world, 10)
})

test('non-finite times and sparse arrays agree with the original filter', () => {
  const world = {eventLog: [{t: Infinity}, , {t: -Infinity}, {t: NaN}, {t: 0}, {t: 10}]}
  for (const now of [-Infinity, -Infinity, 0, Infinity, Infinity, 10, NaN, 10, -Infinity, 0]) {
    matchesFilter(world, now)
  }
  world.eventLog.length += 2
  world.eventLog.push({t: 4})
  matchesFilter(world, 5)
})

test('floating-point boundary keeps subtraction rounding rather than rewriting the cutoff', () => {
  const event = {t: -3.0000000000000004}
  assert.equal(2 - event.t, 5)
  assert.equal(event.t >= 2 - 5, false, 'an algebraic cutoff rewrite would change membership')
  const world = {eventLog: [event]}
  assert.deepEqual(matchesFilter(world, 2), [event])
  matchesFilter(world, 2.000000000000001)
  assert.deepEqual(matchesFilter(world, 2), [event])
})

test('world caches are independent even when worlds share the same log', () => {
  const eventLog = [{t: 0}, {t: 10}, {t: 100}]
  const first = {eventLog}, second = {eventLog}
  matchesFilter(first, 100)
  matchesFilter(second, 5)
  matchesFilter(first, 100)
  matchesFilter(second, 5)
})

test('random append, pause, rewind and snapshot suffix sequences match Array.filter', () => {
  let seed = 0x12345678
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  const world = {eventLog: []}
  let now = 0, id = 0
  const event = () => ({id: id++, t: now + Math.floor(random() * 40) - 20})
  for (let step = 0; step < 2000; step++) {
    const operation = Math.floor(random() * 7)
    if (operation === 0) now += random() * 3
    if (operation === 1) now -= random() * 10
    if (operation === 2) world.eventLog = structuredClone(world.eventLog)
    if (operation === 3) world.eventLog.length = Math.floor(random() * (world.eventLog.length + 1))
    if (operation === 4 && world.eventLog.length) {
      const start = Math.floor(random() * world.eventLog.length)
      const suffix = structuredClone(world.eventLog.slice(start))
      world.eventLog.length = start
      world.eventLog.push(...suffix)
    }
    if (operation >= 4) for (let count = Math.floor(random() * 8); count > 0; count--) world.eventLog.push(event())
    matchesFilter(world, now)
  }
})

test('old history is read once; paused calls and append deltas never rescan it', (t) => {
  const count = 100_000
  const reads = {history: 0, recent: 0, appended: 0, indices: 0}
  const counted = (time, bucket) => ({get t() { reads[bucket]++; return time }})
  const log = Array.from({length: count}, () => counted(0, 'history'))
  log.push(counted(100, 'recent'))
  const world = {eventLog: new Proxy(log, {get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads.indices++
    return Reflect.get(target, key, receiver)
  }})}
  assert.equal(recentEventsFor(world, 100).length, 1)
  assert.equal(reads.history, count)
  reads.history = reads.recent = reads.indices = 0
  for (let call = 0; call < 600; call++) recentEventsFor(world, 100)
  assert.equal(reads.history, 0)
  assert.equal(reads.recent, 0)
  assert.equal(reads.indices, 1200, 'only the previous/current boundary identity is accessed')
  log.push(counted(0, 'appended'), counted(99, 'appended'), counted(200, 'appended'))
  reads.indices = 0
  assert.equal(recentEventsFor(world, 100).length, 3)
  assert.equal(reads.appended, 3, 'only appended timestamps are examined while paused')
  assert.equal(reads.history, 0)
  assert.equal(reads.indices, 5, 'delta entries plus two boundary reads')
  for (let call = 1; call <= 300; call++) recentEventsFor(world, 100 + call / 30)
  assert.equal(reads.history, 0, 'advancing time examines only retained candidates')
  reads.recent = 0
  for (let call = 0; call < 300; call++) recentEventsFor(world, 111 + call / 30)
  assert.equal(reads.recent, 0, 'expired candidates are released from the projection')
  t.diagnostic(`history=${count}; 600 paused + append delta + 600 advancing calls: historical timestamp rereads=${reads.history}`)
})
