import {Vector2, WebGLRenderTarget, HalfFloatType, ShaderMaterial, FullScreenQuad, NoBlending, VignettePlugin, FilmicGrainPlugin, SSAOPlugin, UnsignedByteType} from 'threepipe'
import {UnrealBloomPass} from './post-unreal-bloom.js'

// Threepipe 0.5.1 does not remove this listener before clearing the SSAO pass.
// GBuffer teardown then calls the stale listener during headless viewer disposal.
class RuntimeSSAOPlugin extends SSAOPlugin {
  onRemove(viewer) {
    viewer.renderManager.removeEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
    return super.onRemove(viewer)
  }
}

// Runtime composition only. Do not serialize effects into the authored scene.
export class MapPost {
  constructor(viewer) { this.viewer = viewer; this.plugins = [] }
  start() {
    const viewer = this.viewer
    const bloom = new UnrealBloomPass(new Vector2(640, 360), 0.38, 0.55, 1.05)
    const linear = new WebGLRenderTarget(640, 360, {type: HalfFloatType, depthBuffer: false})
    const rgbm = viewer.renderManager.rgbm
    const vertexShader = 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}'
    const decode = new ShaderMaterial({uniforms: {inputMap: {value: null}}, vertexShader,
      fragmentShader: `uniform sampler2D inputMap; varying vec2 vUv; void main(){vec4 c=texture2D(inputMap,vUv); gl_FragColor=vec4(c.rgb${rgbm ? '*c.a*16.' : ''},1.);}`,
      depthTest: false, depthWrite: false, blending: NoBlending})
    const combine = new ShaderMaterial({uniforms: {inputMap: {value: null}, bloomMap: {value: null}}, vertexShader,
      fragmentShader: `uniform sampler2D inputMap; uniform sampler2D bloomMap; varying vec2 vUv;
        void main(){vec4 base=texture2D(inputMap,vUv); vec3 c=base.rgb${rgbm ? '*base.a*16.' : ''}+texture2D(bloomMap,vUv).rgb;
        ${rgbm ? 'float m=max(1./255.,ceil(clamp(max(c.r,max(c.g,c.b))/16.,0.,1.)*255.)/255.);gl_FragColor=vec4(c/(m*16.),m);' : 'gl_FragColor=vec4(c,base.a);'}}`,
      depthTest: false, depthWrite: false, blending: NoBlending})
    const quad = new FullScreenQuad(decode)
    // Threepipe defaults to RGBM16. Decode before UnrealBloomPass, then combine and
    // re-encode into the composer buffer without corrupting its packed alpha.
    this.bloom = {
      passId: 'map-bloom', after: ['render'], before: ['screen'], required: ['render'],
      enabled: true, needsSwap: true, renderToScreen: false,
      setSize(width, height) {
        const w = Math.max(1, Math.round(width * 0.5)), h = Math.max(1, Math.round(height * 0.5))
        linear.setSize(w, h); bloom.setSize(w, h)
      },
      render(renderer, writeBuffer, readBuffer, delta) {
        decode.uniforms.inputMap.value = readBuffer.texture
        quad.material = decode; renderer.setRenderTarget(linear); quad.render(renderer)
        bloom.render(renderer, null, linear, delta, false)
        combine.uniforms.inputMap.value = readBuffer.texture
        combine.uniforms.bloomMap.value = bloom.renderTargetsHorizontal[0].texture
        quad.material = combine; renderer.setRenderTarget(writeBuffer); quad.render(renderer)
      },
      dispose() { bloom.dispose(); linear.dispose(); decode.dispose(); combine.dispose(); quad.dispose() },
    }
    viewer.renderManager.registerPass(this.bloom)
    const install = (Type, create, configure) => {
      // Preserve an existing effect owned by the editor or another view.
      if (viewer.getPlugin(Type)) return
      const plugin = viewer.addPluginSync(create())
      if (viewer.getPlugin(Type) !== plugin) return
      configure(plugin)
      this.plugins.push(plugin)
    }
    install(VignettePlugin, () => new VignettePlugin(), p => { p.power = 0.22 })
    install(FilmicGrainPlugin, () => new FilmicGrainPlugin(), p => { p.intensity = 0.35 })
    if (viewer.renderManager.gbufferTarget && viewer.renderManager.gbufferUnpackExtension) {
      install(RuntimeSSAOPlugin, () => new RuntimeSSAOPlugin(UnsignedByteType, 0.5), p => {
        p.pass.intensity = 0.22
        p.pass.occlusionWorldRadius = 0.8
        p.pass.numSamples = 4
      })
    }
  }
  stop() {
    if (this.bloom) {
      this.viewer.renderManager.unregisterPass(this.bloom)
      this.bloom.dispose()
      this.bloom = null
    }
    for (const plugin of this.plugins.reverse()) this.viewer.removePluginSync(plugin)
    this.plugins = []
  }
}
