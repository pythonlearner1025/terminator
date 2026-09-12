// Use the benchmark's Mac renderer for the unchanged Kite3D checks.
// NODE_OPTIONS="--require=./tools/check-headless-metal.cjs" npx kite3d check
const {createRequire} = require('node:module')
const {resolve} = require('node:path')
const kiteRequire = createRequire(resolve(__dirname, '../node_modules/kite3d/src/check.ts'))
const {chromium} = kiteRequire('playwright')
const launch = chromium.launch.bind(chromium)
chromium.launch = (options = {}) => launch({
  ...options,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [...(options.args || []), '--use-angle=metal'],
})
