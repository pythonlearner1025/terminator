import {Vector2, WebGLRenderTarget, HalfFloatType, ShaderMaterial, FullScreenQuad, NoBlending, VignettePlugin, FilmicGrainPlugin, SSAOPlugin, UnsignedByteType} from 'threepipe'
import {UnrealBloomPass} from './post-unreal-bloom.js'
import {WEATHER_DEFAULTS} from './weather.js'
import {getQualityPreset} from './performance-quality.js'

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
  constructor(viewer, quality = getQualityPreset('high')) {
    this.viewer = viewer; this.plugins = []; this.quality = quality
    this.settings = {motionBlur: WEATHER_DEFAULTS.motionBlur, bloomScale: quality.bloomScale}
  }
  start() {
    const viewer = this.viewer
    const bloom = new UnrealBloomPass(new Vector2(640, 360), 0.3, 0.55, 1.2)
    const linear = new WebGLRenderTarget(640, 360, {type: HalfFloatType, depthBuffer: false})
    const rgbm = viewer.renderManager.rgbm
    const vertexShader = 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}'
    const decode = new ShaderMaterial({uniforms: {inputMap: {value: null}}, vertexShader,
      fragmentShader: `uniform sampler2D inputMap; varying vec2 vUv; void main(){vec4 c=texture2D(inputMap,vUv); gl_FragColor=vec4(c.rgb${rgbm ? '*c.a*16.' : ''},1.);}`,
      depthTest: false, depthWrite: false, blending: NoBlending})
    const combine = new ShaderMaterial({uniforms: {inputMap: {value: null}, bloomMap: {value: null}, blur: {value: new Vector2()}}, vertexShader,
      fragmentShader: `uniform sampler2D inputMap; uniform sampler2D bloomMap; uniform vec2 blur; varying vec2 vUv;
        void main(){vec4 base=texture2D(inputMap,vUv);
        vec3 c=base.rgb${rgbm ? '*base.a*16.' : ''};
        // Decode each tap before averaging the optional camera rotation blur.
        if(length(blur)>.00001) {
          vec4 a=texture2D(inputMap,vUv-blur), b=texture2D(inputMap,vUv+blur);
          c=(c*2.+a.rgb${rgbm ? '*a.a*16.' : ''}+b.rgb${rgbm ? '*b.a*16.' : ''})*.25;
        }
        c+=texture2D(bloomMap,vUv).rgb;
        float l=dot(c,vec3(.2126,.7152,.0722));
        float warmth=smoothstep(.08,.6,c.r-c.b);
        c=mix(vec3(l),c,mix(.78,1.,warmth));
        c*=mix(vec3(.90,.99,1.10),vec3(1.03,1.,.96),smoothstep(.15,1.7,l));
        ${rgbm ? 'float m=max(1./255.,ceil(clamp(max(c.r,max(c.g,c.b))/16.,0.,1.)*255.)/255.);gl_FragColor=vec4(c/(m*16.),m);' : 'gl_FragColor=vec4(c,base.a);'}}`,
      depthTest: false, depthWrite: false, blending: NoBlending})
    this.combine = combine
    const quad = new FullScreenQuad(decode)
    // Threepipe defaults to RGBM16. Decode before UnrealBloomPass, then combine and
    // re-encode into the composer buffer without corrupting its packed alpha.
    this.bloom = {
      passId: 'map-bloom', after: ['render'], before: ['screen'], required: ['render'],
      enabled: true, needsSwap: true, renderToScreen: false,
      setSize: (width, height) => {
        const w = Math.max(1, Math.round(width * this.settings.bloomScale)), h = Math.max(1, Math.round(height * this.settings.bloomScale))
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
      if (viewer.getPlugin(Type)) return null
      const plugin = viewer.addPluginSync(create())
      if (viewer.getPlugin(Type) !== plugin) return null
      configure(plugin)
      this.plugins.push(plugin)
      return plugin
    }
    install(VignettePlugin, () => new VignettePlugin(), p => { p.power = 0.22 })
    install(FilmicGrainPlugin, () => new FilmicGrainPlugin(), p => { p.intensity = 0.12 })
    if (viewer.renderManager.gbufferTarget && viewer.renderManager.gbufferUnpackExtension) {
      this.ssao = install(RuntimeSSAOPlugin, () => new RuntimeSSAOPlugin(UnsignedByteType, this.quality.ssaoScale), p => {
        p.pass.intensity = 0.32
        p.pass.occlusionWorldRadius = 0.8
        p.pass.numSamples = this.quality.ssaoSamples
      })
    }
    this.gbufferTarget = viewer.renderManager.gbufferTarget
    this.originalGbufferScale = this.gbufferTarget?.sizeMultiplier
    this.originalSsaoScale = this.ssao?.target?.sizeMultiplier
    this.setQuality(this.quality)
  }
  setQuality(quality) {
    this.quality = quality
    this.settings.bloomScale = quality.bloomScale
    const manager = this.viewer.renderManager
    if (this.gbufferTarget) this.gbufferTarget.sizeMultiplier = quality.gbufferScale
    if (this.ssao?.target) this.ssao.target.sizeMultiplier = quality.ssaoScale
    if (this.ssao?.pass) this.ssao.pass.numSamples = quality.ssaoSamples
    manager.setSize(undefined, undefined, true)
  }
  sync() {
    if (!this.combine) return
    const camera = this.viewer.scene.mainCamera
    const rotation = camera.rotation
    const prior = this.rotation
    this.combine.uniforms.blur.value.set(this.settings.motionBlur && prior ? Math.max(-.014,Math.min(.014,(rotation.y-prior.y)*.1)) : 0,
      this.settings.motionBlur && prior ? Math.max(-.014,Math.min(.014,(rotation.x-prior.x)*.1)) : 0)
    this.rotation ||= new Vector2()
    this.rotation.set(rotation.x,rotation.y)
  }
  stop() {
    const manager = this.viewer.renderManager
    if (this.gbufferTarget) {
      this.gbufferTarget.sizeMultiplier = this.originalGbufferScale ?? 1
      manager.resizeTrackedTarget(this.gbufferTarget)
      this.gbufferTarget.sizeMultiplier = this.originalGbufferScale
    }
    if (this.ssao?.target && this.originalSsaoScale !== undefined) {
      this.ssao.target.sizeMultiplier = this.originalSsaoScale
      manager.resizeTrackedTarget(this.ssao.target)
    }
    if (this.bloom) {
      this.viewer.renderManager.unregisterPass(this.bloom)
      this.bloom.dispose()
      this.bloom = null
    }
    for (const plugin of this.plugins.reverse()) this.viewer.removePluginSync(plugin)
    this.plugins = []; this.combine = null; this.rotation = null; this.ssao = null; this.gbufferTarget = null
  }
}
