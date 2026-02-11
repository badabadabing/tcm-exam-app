import type { SymptomItem } from '../types'
import { pickManyUnique, randomFloat } from '../utils/random'

export function sampleSymptoms(
  items: SymptomItem[],
  ratio?: number,
): { sampled_text: string; sampled_items: SymptomItem[] } {
  const target_ratio = ratio ?? randomFloat(0.6, 0.9)
  const key_items = items.filter((item) => item.is_key)
  const optional_items = items.filter((item) => !item.is_key)

  const min_total = Math.max(key_items.length, Math.ceil(items.length * target_ratio))
  const optional_count = Math.max(0, Math.min(optional_items.length, min_total - key_items.length))
  const picked_optional = pickManyUnique(optional_items, optional_count)
  const picked_set = new Set(picked_optional.map((item) => item.text))

  const merged = items.filter((item) => item.is_key || picked_set.has(item.text))
  const sampled_text = merged.map((item) => item.text).join('，')

  return { sampled_text, sampled_items: merged }
}
