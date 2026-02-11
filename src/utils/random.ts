export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

export function pickOne<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)]
}

export function shuffle<T>(items: T[]): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap_index = randomInt(0, index)
    const temp = next[index]
    next[index] = next[swap_index]
    next[swap_index] = temp
  }
  return next
}

export function pickManyUnique<T>(items: T[], count: number): T[] {
  if (count >= items.length) {
    return shuffle(items)
  }
  return shuffle(items).slice(0, count)
}

export function sampleDuration(): string {
  const values = ['2天', '3天', '5天', '1周', '10天', '半月']
  return pickOne(values)
}

export function sampleGender(is_female_only: boolean): '男' | '女' {
  if (is_female_only) {
    return '女'
  }
  return Math.random() > 0.5 ? '男' : '女'
}

export function sampleSeason(is_summer_only: boolean): string {
  if (is_summer_only) {
    return '夏季'
  }
  return pickOne(['春季', '夏季', '秋季', '冬季'])
}
