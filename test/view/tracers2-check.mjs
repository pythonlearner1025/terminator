// Select a headless hardware backend for the unmodified Kite3D validation suite.
// NODE_OPTIONS='--import=./test/view/tracers2-check.mjs' npx kite3d check
import {chromium} from 'playwright'
const launch=chromium.launch.bind(chromium)
chromium.launch=options=>{
  if(options.headless!==true)throw Error('Only headless validation is permitted')
  return launch({...options,headless:true,
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:[...(options.args||[]),'--use-angle=metal']})
}
