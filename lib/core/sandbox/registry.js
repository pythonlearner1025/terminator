import defaultEndoScriptSource from '../brains/default-endo.script-src.js'
import defaultHeavyScriptSource from '../brains/default-heavy.script-src.js'
import defaultScoutScriptSource from '../brains/default-scout.script-src.js'
import {UnitScriptRuntime, validateScriptSource} from './runtime.js'

export const DEFAULT_SCRIPT_SOURCES = Object.freeze({
  scout: defaultScoutScriptSource,
  endo: defaultEndoScriptSource,
  heavy: defaultHeavyScriptSource,
})

export class UnitScriptRegistry {
  constructor({scriptSources = {}} = {}) {
    this.revisions = new Map()
    for (const [unitType, defaultSource] of Object.entries(DEFAULT_SCRIPT_SOURCES)) {
      const supplied = scriptSources[unitType]
      const record = typeof supplied === 'string'
        ? {rev: 1, source: supplied}
        : supplied || {rev: 1, source: defaultSource}
      this.revisions.set(unitType, [{rev: record.rev, source: record.source}])
    }
  }

  current(unitType) {
    const records = this.revisions.get(unitType)
    return records?.at(-1) || null
  }

  get(unitType, rev) {
    const records = this.revisions.get(unitType)
    if (!records) return null
    if (rev === undefined || rev === null) return records.at(-1)
    return records.find((record) => record.rev === rev) || null
  }

  createBrain(unitType, rev) {
    const record = this.get(unitType, rev)
    if (!record) throw new Error(`No script revision ${rev ?? 'current'} for unit type ${unitType}`)
    return {
      rev: record.rev,
      brain: new UnitScriptRuntime({unitType, rev: record.rev, source: record.source}),
    }
  }

  acceptScript({unitType, source}, smokeRun) {
    const current = this.current(unitType)
    if (!current) return {ok: false, error: `Unknown unit type: ${unitType}`, smokeLog: []}
    if (typeof source !== 'string' || !source.trim()) {
      return {ok: false, error: 'Unit script source must be a non-empty string', smokeLog: []}
    }
    const rev = current.rev + 1
    try {
      validateScriptSource({unitType, rev, source})
    } catch (error) {
      return {ok: false, error: String(error?.message || error), smokeLog: []}
    }

    const smoke = smokeRun({unitType, source, rev})
    if (!smoke.ok) return {ok: false, error: smoke.error, smokeLog: smoke.log}
    this.revisions.get(unitType).push({rev, source})
    return {ok: true, rev}
  }
}
