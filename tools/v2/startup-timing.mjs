// Keep automation intent latency separate from the user's actual Play event.
// Never substitute a pre-Playwright timestamp when a captured event is absent.
export function startupTiming(mode,ready,menuAt) {
  const {at,editorAt,actualEditorClickAt,actualMenuClickAt,actualLobbyClickAt}=ready
  for(const time of [at,editorAt,actualEditorClickAt,actualMenuClickAt,actualLobbyClickAt,menuAt])
    if(!Number.isFinite(time)||time<0)throw Error('Missing or invalid actual startup event timestamp')
  if(editorAt>actualEditorClickAt||actualEditorClickAt>menuAt||menuAt>actualMenuClickAt||actualMenuClickAt>actualLobbyClickAt||actualLobbyClickAt>at)
    throw Error('Startup event timestamps are out of order')
  return {
    startTrigger:mode==='restart'?'manager.start()':'editor DOM click',
    actualStartAt:actualEditorClickAt,readyAt:at,
    actualStartToReadyMs:at-actualEditorClickAt,
    actualStartToMenuMs:menuAt-actualEditorClickAt,
    actualMenuClickToReadyMs:at-actualMenuClickAt,
    actualLobbyClickToReadyMs:at-actualLobbyClickAt,
    automationBeforeStartMs:actualEditorClickAt-editorAt,
    // Retained for comparison with older reports; this is not click latency.
    automationIntentToReadyMs:at-editorAt,
  }
}
