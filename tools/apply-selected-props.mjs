import {fileURLToPath} from 'node:url'
import {applySelectedProps} from './lib/selected-props.mjs'
console.log(await applySelectedProps(fileURLToPath(new URL('../', import.meta.url))))
