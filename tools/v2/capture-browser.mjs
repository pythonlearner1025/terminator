import {chromium} from 'playwright'
import {readFile} from 'node:fs/promises'

export function browserOptions() {
  const linux = process.platform === 'linux'
  return {
    executablePath: process.env.CHROME_PATH || (linux ? '/usr/bin/google-chrome' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
    headless: process.env.CHROME_HEADED !== '1',
    args: process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : linux
      ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--disable-dev-shm-usage']
      : process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  }
}
export async function launchCaptureBrowser() {
  // Chrome's desktop DBus integration can move itself out of the caller's
  // memory-limited cgroup. Block that child-only session bus connection.
  // Keep the environment out of browserOptions(): captures serialize options.
  const env=process.platform==='linux'?{...process.env,DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent-kite3d-capture-bus'}:process.env
  const browser=await chromium.launch({...browserOptions(),env})
  try {
    if(process.platform==='linux') {
      const own=(await readFile('/proc/self/cgroup','utf8')).split('\n').find(line=>line.startsWith('0::'))?.slice(3)
      const session=await browser.newBrowserCDPSession()
      try {
        const {processInfo}=await session.send('SystemInfo.getProcessInfo')
        const processes=await Promise.all(processInfo.map(async info=>({pid:info.id,type:info.type,cgroup:(await readFile(`/proc/${info.id}/cgroup`,'utf8')).split('\n').find(line=>line.startsWith('0::'))?.slice(3)})))
        if(own&&processes.some(info=>info.cgroup!==own))throw Error('Capture browser left inherited cgroup')
        browser.captureCgroup={parent:own,processes,sessionBus:'disabled for child only'}
      } finally {await session.detach()}
    }
    return browser
  } catch(error) {await browser.close();throw error}
}
export async function rendererInfo(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) throw Error('WebGL2 unavailable')
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const result = {renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION)}
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return result
  })
}
