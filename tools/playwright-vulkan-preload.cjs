const Module = require('node:module')

const load = Module._load
Module._load = function loadWithVulkan(request, parent, isMain) {
  const exported = load.call(this, request, parent, isMain)
  if (request !== 'playwright' || exported.__terminatorVulkanLaunch) return exported
  const launch = exported.chromium.launch.bind(exported.chromium)
  exported.chromium.launch = options => launch({
    ...options,
    args: [
      ...(options?.args || []),
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
      '--disable-vulkan-surface',
      '--no-sandbox',
    ],
  })
  Object.defineProperty(exported, '__terminatorVulkanLaunch', {value: true})
  return exported
}
