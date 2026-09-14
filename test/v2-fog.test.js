import {test} from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const {PhysicalMaterial, UnlitMaterial} = await import('threepipe')
const {MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial, ShaderLib, ShaderChunk, Texture} = await import('three')
const {installV2LinearFog} = await import('../lib/view/v2/fog.js')
const marker = '|v2-linear-scene-fog-1'
function shader(kind = 'physical') {
  return {vertexShader: ShaderLib[kind].vertexShader, fragmentShader: ShaderLib[kind].fragmentShader,
    uniforms: {}, defines: {USE_FOG: '', FOG_EXP2: ''}}
}
function compile(material, kind, target = shader(kind)) {
  material.onBeforeCompile(target, {})
  return target
}
function assertLinear(source) {
  const chunks = ['opaque', 'fog', 'tonemapping', 'colorspace', 'premultiplied_alpha', 'dithering']
  const positions = chunks.map(name => source.indexOf(`#include <${name}_fragment>`))
  assert.ok(positions.every((value, index) => value >= 0 && (!index || value > positions[index - 1])))
  assert.equal(source.match(/#include <fog_fragment>/g)?.length, 1)
}

test('installed Physical/Standard/Basic output chain gets one linear fog application; unrelated chunks stay exact', () => {
  const originals = JSON.stringify(ShaderChunk)
  for (const [Type, kind] of [[PhysicalMaterial, 'physical'], [UnlitMaterial, 'basic'],
    [MeshStandardMaterial, 'standard'], [MeshBasicMaterial, 'basic']]) {
    const material = new Type({fog: true, premultipliedAlpha: true})
    const originalCompile = material.onBeforeCompile, originalKey = material.customProgramCacheKey
    const baseline = compile(material, kind)
    const key = material.customProgramCacheKey()
    const handle = installV2LinearFog(material, {owned: true})
    const result = compile(material, kind)
    assertLinear(result.fragmentShader)
    // Removing just the relocated include leaves the original shader byte-for-byte.
    assert.equal(result.fragmentShader.replace('#include <fog_fragment>\n\t', ''),
      baseline.fragmentShader.replace('#include <fog_fragment>', ''))
    assert.equal(result.vertexShader, baseline.vertexShader)
    assert.equal(material.premultipliedAlpha, true)
    assert.equal(material.customProgramCacheKey(), key + marker)
    handle.dispose(); handle.dispose()
    assert.equal(handle.attached, false)
    assert.equal(material.onBeforeCompile, originalCompile)
    assert.equal(material.customProgramCacheKey, originalKey)
    assert.equal(material.customProgramCacheKey(), key)
    assert.equal(compile(material, kind).fragmentShader, baseline.fragmentShader)
    material.dispose()
  }
  assert.equal(JSON.stringify(ShaderChunk), originals, 'no global shader mutation')
})

test('preserves real extensions, events, existing hook receivers and dynamic cache keys', () => {
  const material = new PhysicalMaterial({fog: true})
  let keyVersion = 1, extensionCalls = 0, wrapperCalls = 0, eventCalls = 0
  const extension = {computeCacheKey: () => `fixture-extension-${keyVersion}`,
    shaderExtender(s, m) {assert.equal(m, material); extensionCalls++; s.uniforms.fixture = {value: 42}}}
  material.registerMaterialExtensions([extension])
  material.addEventListener('beforeCompile', () => eventCalls++)
  const parentCompile = material.onBeforeCompile, parentKey = material.customProgramCacheKey
  material.onBeforeCompile = function(s, renderer) {
    assert.equal(this, material); parentCompile.call(this, s, renderer); wrapperCalls++
    s.fragmentShader = '// preexisting surface hook\n' + s.fragmentShader
  }
  material.customProgramCacheKey = function() {return parentKey.call(this) + `|surface-${keyVersion}`}
  const before = material.customProgramCacheKey()
  const methods = [material.onBeforeCompile, material.customProgramCacheKey]
  const extensions = material.materialExtensions
  const handle = installV2LinearFog(material, {owned: true})
  assert.equal(material.customProgramCacheKey(), before + marker)
  const result = compile(material, 'physical')
  assertLinear(result.fragmentShader); assert.equal(result.uniforms.fixture.value, 42)
  assert.deepEqual([extensionCalls, wrapperCalls, eventCalls], [1, 1, 1])
  keyVersion = 2
  assert.ok(material.customProgramCacheKey().includes('fixture-extension-2'))
  assert.ok(material.customProgramCacheKey().endsWith('|surface-2' + marker))
  handle.dispose()
  assert.equal(material.materialExtensions, extensions)
  assert.deepEqual([material.onBeforeCompile, material.customProgramCacheKey], methods)
  material.unregisterMaterialExtensions([extension]); material.dispose()
})

test('idempotent install and material disposal restore exact descriptors without listener growth', () => {
  const material = new PhysicalMaterial({fog: true})
  const before = Object.getOwnPropertyDescriptors(material)
  const count = () => material._listeners?.dispose?.length || 0
  const listeners = count()
  for (let cycle = 0; cycle < 3; cycle++) {
    const version = material.version
    const first = installV2LinearFog(material, {owned: true})
    assert.equal(installV2LinearFog(material, {owned: true}), first)
    assert.equal(material.version, version + 1)
    assert.equal(count(), listeners + 1)
    assert.equal(material.customProgramCacheKey().split(marker).length, 2)
    material.dispose()
    assert.equal(first.attached, false); assert.equal(count(), listeners)
    for (const name of ['onBeforeCompile', 'customProgramCacheKey']) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(material, name), before[name])
    }
  }
})

test('explicit ownership gate, fog-false exclusion and independent clone ownership', () => {
  const authored = new PhysicalMaterial({fog: true}), clone = new PhysicalMaterial().copy(authored)
  const methods = [authored.onBeforeCompile, authored.customProgramCacheKey]
  const authoredKey = authored.customProgramCacheKey(), version = authored.version
  assert.throws(() => installV2LinearFog(authored), /explicitly owned/)
  const handle = installV2LinearFog(clone, {owned: true})
  assertLinear(compile(clone, 'physical').fragmentShader)
  assert.deepEqual([authored.onBeforeCompile, authored.customProgramCacheKey], methods)
  assert.equal(authored.customProgramCacheKey(), authoredKey); assert.equal(authored.version, version)
  // Copying a patched source hook cannot silently opt a different material in.
  const other = new MeshStandardMaterial({fog: true})
  other.onBeforeCompile = clone.onBeforeCompile
  assert.ok(compile(other, 'standard').fragmentShader.indexOf('#include <fog_fragment>') >
    ShaderLib.standard.fragmentShader.indexOf('#include <colorspace_fragment>'))
  const sky = new UnlitMaterial({fog: false}), skyVersion = sky.version
  const skyMethod = sky.onBeforeCompile, skyKey = sky.customProgramCacheKey
  assert.equal(installV2LinearFog(sky, {owned: true}).attached, false)
  assert.equal(sky.version, skyVersion); assert.equal(sky.onBeforeCompile, skyMethod)
  assert.equal(sky.customProgramCacheKey, skyKey)
  handle.dispose(); clone.dispose(); authored.dispose(); other.dispose(); sky.dispose()
})

test('already-linear input stays single; absent auxiliary output skips; ambiguous layouts reject', () => {
  const material = new MeshStandardMaterial({fog: true})
  const handle = installV2LinearFog(material, {owned: true})
  const once = compile(material, 'standard')
  const text = once.fragmentShader
  compile(material, 'standard', once)
  assert.equal(once.fragmentShader, text)
  const aux = {...ShaderLib.depth}
  compile(material, 'standard', aux)
  assert.equal(aux.fragmentShader, ShaderLib.depth.fragmentShader)
  for (const fragmentShader of [
    ShaderLib.standard.fragmentShader.replace('#include <fog_fragment>', ''),
    ShaderLib.standard.fragmentShader + '\n#include <fog_fragment>',
    ShaderLib.standard.fragmentShader.replace('#include <premultiplied_alpha_fragment>', ''),
    ShaderLib.standard.fragmentShader.replace('#include <opaque_fragment>', '#include <fog_fragment>')
      .replace('#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>', '#include <opaque_fragment>\n\t#include <premultiplied_alpha_fragment>'),
  ]) {
    assert.throws(() => compile(material, 'standard', {fragmentShader, vertexShader: ''}), /V2 linear fog:/)
  }
  handle.dispose(); material.dispose()
  assert.throws(() => installV2LinearFog(new ShaderMaterial({fog: true}), {owned: true}), /supports/)
})

test('cleanup preserves later hooks and deactivates the retained composed wrapper', () => {
  const material = new MeshBasicMaterial({fog: true})
  const handle = installV2LinearFog(material, {owned: true})
  const installedCompile = material.onBeforeCompile, installedKey = material.customProgramCacheKey
  const laterCompile = function(s, r) {installedCompile.call(this, s, r); s.uniforms.later = {value: 1}}
  const laterKey = function() {return installedKey.call(this) + '|later'}
  material.onBeforeCompile = laterCompile; material.customProgramCacheKey = laterKey
  handle.dispose()
  assert.equal(material.onBeforeCompile, laterCompile); assert.equal(material.customProgramCacheKey, laterKey)
  const result = compile(material, 'basic')
  assert.equal(result.fragmentShader, ShaderLib.basic.fragmentShader)
  assert.equal(result.uniforms.later.value, 1)
  assert.ok(!material.customProgramCacheKey().includes(marker))
  material.dispose()
})


test('helper never changes borrowed texture subscriptions, source maps or uniforms', () => {
  const texture = new Texture(), source = new PhysicalMaterial({map: texture, fog: false})
  const owned = new PhysicalMaterial().copy(source); owned.fog = true
  const listeners = [...texture._listeners.update]
  const sourceKey = source.customProgramCacheKey(), sourceVersion = source.version
  const handle = installV2LinearFog(owned, {owned: true})
  const target = shader(); const uniforms = target.uniforms
  uniforms.fogColor = {value: source.color}; uniforms.fogDensity = {value: .0115}
  compile(owned, 'physical', target)
  assert.equal(target.uniforms, uniforms)
  assert.equal(uniforms.fogDensity.value, .0115)
  assert.equal(uniforms.fogColor.value, source.color)
  handle.dispose()
  assert.deepEqual(texture._listeners.update, listeners)
  assert.equal(source.map, texture); assert.equal(owned.map, texture)
  assert.equal(source.customProgramCacheKey(), sourceKey); assert.equal(source.version, sourceVersion)
  for (const material of [owned, source]) {material.map = null; material.setDirty(); material.dispose()}
  texture.dispose()
})
