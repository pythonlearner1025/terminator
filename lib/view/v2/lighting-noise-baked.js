import {LIGHTING_NOISE_BAKE as manifest} from './lighting-noise-baked-manifest.js'

/** One bounded decoded cache, like the original procedural default-map caches.
 * Only completed immutable production bytes are shared. Aborted/failed requests
 * cannot poison later mounts; textures and their ownership remain per mount.
 */
export function createLightingNoiseLoader({fetchImpl=(...args)=>fetch(...args),decompress=async response=>{
  if(!response.body)throw new Error('V2 atmosphere asset has no response body')
  return new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
}}={}) {
  let cached
  return async function load({signal}={}) {
    signal?.throwIfAborted()
    if(cached)return cached
    const response=await fetchImpl(manifest.url,{signal})
    if(!response.ok)throw new Error(`V2 atmosphere asset: HTTP ${response.status}`)
    const bytes=await decompress(response)
    signal?.throwIfAborted()
    if(!(bytes instanceof Uint8Array)||bytes.byteLength!==manifest.rawByteLength)throw new Error('V2 atmosphere asset: invalid RGBA size')
    const maps={}
    for(const [id,entry] of Object.entries(manifest.maps))maps[id]=Object.freeze({data:bytes.subarray(entry.offset,entry.offset+entry.byteLength),width:entry.width,height:entry.height})
    // Concurrent initial mounts can finish independently; either result contains
    // the same bounded payload. No pending promise or abort controller is shared.
    cached=Object.freeze(maps)
    return cached
  }
}
export const loadBakedLightingNoise=createLightingNoiseLoader()
