export async function waitForProjectLoaded(page, {timeout = 120_000} = {}) {
  await page.waitForFunction(() => Boolean(window.kite3dProjectLoaded && window.viewer?.scene?.modelRoot), null, {timeout})
}

export async function runEditor(page, {timeout = 120_000} = {}) {
  await waitForProjectLoaded(page, {timeout})
  const controls = page.locator('.isPlayingContainer button')
  await controls.nth(2).waitFor({state: 'visible', timeout})
  await controls.nth(2).click()
  await page.waitForFunction(() => {
    const buttons = document.querySelectorAll('.isPlayingContainer button')
    return buttons[2]?.classList.contains('bp5-active')
  }, null, {timeout})
}

export async function stopEditor(page, {timeout = 120_000} = {}) {
  const controls = page.locator('.isPlayingContainer button')
  await controls.nth(0).waitFor({state: 'visible', timeout})
  await controls.nth(0).click()
  await page.waitForFunction(() => {
    const buttons = document.querySelectorAll('.isPlayingContainer button')
    return buttons[0]?.classList.contains('bp5-active')
  }, null, {timeout})
}

export function getCanvas(page) {
  return page.locator('.editorCanvasContainer canvas').first()
}

export async function rendererMemory(page) {
  await page.evaluate(() => window.viewer.setDirty())
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const renderer = window.viewer.renderManager.webglRenderer
    return {...renderer.info.memory, programs: renderer.info.programs?.length ?? null}
  })
}
