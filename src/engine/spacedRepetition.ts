export interface Sm2State {
  easiness_factor: number
  interval: number
  repetition: number
  next_review_date: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_EASINESS_FACTOR = 2.5

export function createInitialSm2State(base_timestamp = Date.now()): Sm2State {
  return {
    easiness_factor: DEFAULT_EASINESS_FACTOR,
    interval: 1,
    repetition: 0,
    next_review_date: base_timestamp + DAY_MS,
  }
}

export function getReviewQuality(is_correct: boolean, duration_ms: number): number {
  if (!is_correct) {
    return 2
  }
  if (duration_ms <= 20_000) {
    return 5
  }
  if (duration_ms <= 60_000) {
    return 4
  }
  return 3
}

export function getNextSm2State(
  previous: Sm2State | null,
  quality: number,
  base_timestamp = Date.now(),
): Sm2State {
  const current = previous ?? createInitialSm2State(base_timestamp)
  const bounded_quality = Math.max(0, Math.min(5, quality))
  let easiness_factor = current.easiness_factor
  let repetition = current.repetition
  let interval = current.interval

  if (bounded_quality < 3) {
    repetition = 0
    interval = 1
  } else {
    repetition += 1
    if (repetition === 1) {
      interval = 1
    } else if (repetition === 2) {
      interval = 6
    } else {
      interval = Math.max(1, Math.round(current.interval * easiness_factor))
    }
  }

  easiness_factor = easiness_factor + (0.1 - (5 - bounded_quality) * (0.08 + (5 - bounded_quality) * 0.02))
  if (easiness_factor < 1.3) {
    easiness_factor = 1.3
  }

  return {
    easiness_factor: Number(easiness_factor.toFixed(2)),
    interval,
    repetition,
    next_review_date: base_timestamp + interval * DAY_MS,
  }
}
