import {AViewerPluginSync} from 'threepipe'
import {holdStartupRendering} from '../startup-rendering.js'
import {installExactImageSourceSharing} from './exact-image-source-cache.js'

export default class ExactImageSourcePlugin extends AViewerPluginSync {
  static PluginType='V2ExactImageSourceSharing'
  enabled=true
  onAdded(viewer) {
    super.onAdded(viewer)
    this.sharing=installExactImageSourceSharing(viewer.assetManager.importer,{
      // Later imports still await byte identity, but never suspend active gameplay.
      holdRendering:()=>viewer.timeline?.running||viewer.getPlugin?.('EntityComponentPlugin')?.running?null:holdStartupRendering(viewer),
      hasUploaded:texture=>{
        const properties=viewer.renderManager.webglRenderer?.properties
        return !properties||Boolean(properties.get(texture).__webglInit)
      },
    })
    this.stats=this.sharing.stats
  }
  onRemove(viewer) {
    this.sharing?.dispose();this.sharing=null
    super.onRemove(viewer)
  }
}
