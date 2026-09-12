// The default headless shell uses software WebGL on this Mac. Keep the standard
// Kite3D checker, using the installed full Chromium executable in headless mode.
import {chromium} from 'playwright'
const launch=chromium.launch.bind(chromium)
chromium.launch=options=>launch({...options,headless:true,executablePath:chromium.executablePath()})
