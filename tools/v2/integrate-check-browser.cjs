// CLI-only launch adaptation. Never changes installed Playwright or Kite3D files.
const {createRequire} = require('node:module')
const path = require('node:path')
const projectRequire = createRequire(path.resolve(process.cwd(), 'package.json'))
const {chromium} = projectRequire('playwright')
const original = chromium.launch.bind(chromium)
chromium.launch = options => original({...options,
  env: {...process.env, ...options?.env, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-kite3d-capture-bus'},
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
})
