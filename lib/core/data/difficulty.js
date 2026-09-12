// Applied after performance and player-count scaling. Normal preserves the original tune.
export const DIFFICULTIES = Object.freeze({
  normal: Object.freeze({id: 'normal', label: 'Normal', budgetMultiplier: 1, unitHealthMultiplier: 1}),
  hard: Object.freeze({id: 'hard', label: 'Hard', budgetMultiplier: 1.25, unitHealthMultiplier: 1.15}),
  suicidal: Object.freeze({id: 'suicidal', label: 'Suicidal', budgetMultiplier: 1.5, unitHealthMultiplier: 1.35}),
  hell: Object.freeze({id: 'hell', label: 'Hell on Earth', budgetMultiplier: 1.8, unitHealthMultiplier: 1.6}),
})

export function getDifficulty(id) {
  return Object.hasOwn(DIFFICULTIES, id) ? DIFFICULTIES[id] : DIFFICULTIES.normal
}
