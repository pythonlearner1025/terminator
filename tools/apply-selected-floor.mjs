import {fileURLToPath} from 'node:url'
import {applySelectedFloor} from './lib/selected-floor.mjs'
console.log(JSON.stringify(await applySelectedFloor(fileURLToPath(new URL('../', import.meta.url)))))
