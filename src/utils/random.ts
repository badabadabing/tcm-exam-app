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

/* ──── 病案生成辅助 ──── */

const SURNAMES = [
  '张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗',
  '宋', '郑', '韩', '唐', '冯', '许', '邓', '曹', '彭', '曾',
]

export function sampleSurname(): string {
  return pickOne(SURNAMES)
}

/** 急性病程（感冒、急性发热等） */
export function sampleAcuteDuration(): string {
  return pickOne(['1天', '2天', '3天', '4天', '5天', '1周'])
}

/** 亚急性病程 */
export function sampleSubacuteDuration(): string {
  return pickOne(['1周', '10天', '2周', '半月', '3周', '1月'])
}

/** 慢性病程 */
export function sampleChronicDuration(): string {
  return pickOne(['3个月', '半年', '1年', '2年', '3年余', '5年余'])
}

/** 慢性病伴急性加重 */
export function sampleChronicWithFlare(): string {
  const chronic = pickOne(['1年', '2年', '3年', '5年余'])
  const flare = pickOne(['3天', '5天', '1周', '10天'])
  return `反复发作${chronic}，加重${flare}`
}

/** 根据病种急慢性特征采样病程 */
export function sampleDurationByAcuity(acuity: 'acute' | 'subacute' | 'chronic' | 'chronic_flare'): string {
  if (acuity === 'acute') return sampleAcuteDuration()
  if (acuity === 'subacute') return sampleSubacuteDuration()
  if (acuity === 'chronic_flare') return sampleChronicWithFlare()
  return sampleChronicDuration()
}
