import type { Disease, Syndrome } from '../types'
import { pickManyUnique } from '../utils/random'

export type DistractorField = 'syndrome_name' | 'treatment_method' | 'prescription' | 'pathogenesis'

function getFieldValue(syndrome: Syndrome, field: DistractorField): string {
  if (field === 'syndrome_name') {
    return syndrome.syndrome_name
  }
  if (field === 'treatment_method') {
    return syndrome.treatment_method
  }
  if (field === 'prescription') {
    return syndrome.prescription.primary
  }
  return syndrome.pathogenesis
}

function getDiseaseById(diseases: Disease[], disease_id: string): Disease | undefined {
  return diseases.find((item) => item.disease_id === disease_id)
}

function pushUnique(candidates: string[], next_values: string[], excluded: Set<string>) {
  for (const value of next_values) {
    const normalized = value.trim()
    if (!normalized || excluded.has(normalized)) {
      continue
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized)
    }
  }
}

export function generateDistractors(
  diseases: Disease[],
  syndromes: Syndrome[],
  syndrome_id: string,
  field: DistractorField,
  correct_answer: string,
  count = 4,
): string[] {
  const target = syndromes.find((item) => item.syndrome_id === syndrome_id)
  if (!target) {
    return []
  }

  const excluded = new Set<string>([correct_answer.trim()])
  const candidates: string[] = []

  // 第一优先级：同病种
  const same_disease = syndromes
    .filter((item) => item.disease_id === target.disease_id && item.syndrome_id !== target.syndrome_id)
    .map((item) => getFieldValue(item, field))
  pushUnique(candidates, same_disease, excluded)

  // 第二优先级：关联病种
  if (candidates.length < count) {
    const disease = getDiseaseById(diseases, target.disease_id)
    const related_ids = disease?.related_diseases ?? []
    const related_values = syndromes
      .filter((item) => related_ids.includes(item.disease_id))
      .map((item) => getFieldValue(item, field))
    pushUnique(candidates, related_values, excluded)
  }

  // 第三优先级：全局池
  if (candidates.length < count) {
    const global_values = syndromes.map((item) => getFieldValue(item, field))
    pushUnique(candidates, global_values, excluded)
  }

  return pickManyUnique(candidates, count)
}
