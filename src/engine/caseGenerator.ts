/**
 * 病案论述题生成引擎
 *
 * 将每个证型转换为标准病案（临床模拟题），包含：
 * - 符合性别/年龄约束的患者信息（由 demographics.ts 统一管理）
 * - 从症状数据自动分离的舌诊、脉诊
 * - 自然语言的病案叙述
 * - 标准答案（诊断、病机、治法、方药）
 */

import type { CaseQuestion, CaseStandardAnswer, Disease, Syndrome, SymptomItem } from '../types'
import { sampleSymptoms } from './symptomSampler'
import {
  PEDIATRIC_DISEASE_IDS,
  getDiseaseAcuity,
  resolveDemographics,
  resolveSeason,
} from './demographics'
import {
  pickOne,
  randomInt,
  sampleDurationByAcuity,
  sampleSurname,
} from '../utils/random'

/* ──── 症状分离：主症 / 舌诊 / 脉诊 ──── */

interface SplitSymptoms {
  main_symptoms: SymptomItem[]
  tongue_items: SymptomItem[]
  pulse_items: SymptomItem[]
}

function splitSymptomItems(items: SymptomItem[]): SplitSymptoms {
  const main_symptoms: SymptomItem[] = []
  const tongue_items: SymptomItem[] = []
  const pulse_items: SymptomItem[] = []

  for (const item of items) {
    if (/^舌|舌质|舌苔|舌体|舌色|舌边|舌下/.test(item.text)) {
      tongue_items.push(item)
    } else if (/^脉/.test(item.text)) {
      pulse_items.push(item)
    } else {
      main_symptoms.push(item)
    }
  }

  return { main_symptoms, tongue_items, pulse_items }
}

/* ──── 主诉构建 ──── */

function buildChiefComplaint(disease: Disease, duration: string, extra_context: string): string {
  const key = disease.key_symptoms.replace(/[、，,]/g, '').replace(/\s+/g, '')
  const trimmed = key.length > 12 ? key.slice(0, 12) : key
  const context_prefix = extra_context ? `${extra_context}，` : ''
  return `${context_prefix}${trimmed}${duration}`
}

/* ──── 病案正文生成 ──── */

function buildCaseText(
  disease: Disease,
  syndrome: Syndrome,
  sampled_items: SymptomItem[],
): string {
  const d = resolveDemographics(disease, syndrome)
  const surname = sampleSurname()
  const is_pediatric = PEDIATRIC_DISEASE_IDS.has(disease.disease_id) || disease.category === '儿科'

  // 病程由 demographics 统一提供，但病案文本需要通过 acuity 重新采样以保持独立随机性
  const acuity = getDiseaseAcuity(disease.disease_id)
  const duration = sampleDurationByAcuity(acuity)
  const season = resolveSeason(syndrome.syndrome_name, disease.disease_id)

  // 分离主症 / 舌 / 脉
  const { main_symptoms, tongue_items, pulse_items } = splitSymptomItems(sampled_items)
  const main_text = main_symptoms.map((item) => item.text).join('，')
  const tongue_text = tongue_items.map((item) => item.text).join('，')
  const pulse_text = pulse_items.map((item) => item.text).join('，')

  // 主诉
  const chief_complaint = buildChiefComplaint(disease, duration, d.extra_context)

  const age_str = d.age_unit === '个月' ? `${d.age}个月` : `${d.age}${d.age_unit}`
  const season_part = season ? `${season}来诊。` : ''

  const parts: string[] = []

  if (is_pediatric) {
    parts.push(`患儿${surname}某，${d.gender}，${age_str}。`)
  } else {
    parts.push(`${surname}某，${d.gender}，${age_str}。`)
  }

  parts.push(`因"${chief_complaint}"就诊。`)

  if (season_part) {
    parts.push(season_part)
  }

  parts.push(`现症见：${main_text}。`)

  if (tongue_text) {
    parts.push(`${tongue_text}。`)
  }
  if (pulse_text) {
    parts.push(`${pulse_text}。`)
  }

  return parts.join('')
}

/* ──── 标准答案构建 ──── */

function buildStandardAnswer(disease: Disease, syndrome: Syndrome): CaseStandardAnswer {
  const secondary = syndrome.prescription.alternative ? `（或${syndrome.prescription.alternative}）` : ''
  return {
    disease_name: disease.disease_name,
    syndrome_name: syndrome.syndrome_name,
    diagnosis_text: `${disease.disease_name}·${syndrome.syndrome_name}`,
    pathogenesis: syndrome.pathogenesis,
    treatment_method: syndrome.treatment_method,
    prescription: `${syndrome.prescription.primary}${secondary}`,
    key_symptom_analysis: syndrome.key_symptom_analysis,
    full_symptoms: syndrome.symptoms.full_text,
  }
}

/* ──── 公共 API ──── */

export interface CaseDataset {
  diseases: Disease[]
  syndromes: Syndrome[]
}

/**
 * 为指定证型生成一道病案论述题
 */
export function generateCaseQuestion(dataset: CaseDataset, syndrome: Syndrome): CaseQuestion {
  const disease = dataset.diseases.find((d) => d.disease_id === syndrome.disease_id)
  if (!disease) {
    throw new Error(`疾病不存在: ${syndrome.disease_id}`)
  }

  // 采样症状（保留全部关键症状 + 随机部分非关键症状）
  const { sampled_items } = sampleSymptoms(syndrome.symptoms.items)

  const case_text = buildCaseText(disease, syndrome, sampled_items)
  const standard_answer = buildStandardAnswer(disease, syndrome)

  return {
    id: `CASE_${syndrome.syndrome_id}_${Date.now()}_${randomInt(1000, 9999)}`,
    syndrome_id: syndrome.syndrome_id,
    disease_id: syndrome.disease_id,
    case_text,
    standard_answer,
  }
}

/**
 * 通过证型 ID 生成病案题
 */
export function generateCaseById(dataset: CaseDataset, syndrome_id: string): CaseQuestion {
  const syndrome = dataset.syndromes.find((s) => s.syndrome_id === syndrome_id)
  if (!syndrome) {
    throw new Error(`证型不存在: ${syndrome_id}`)
  }
  return generateCaseQuestion(dataset, syndrome)
}

/**
 * 为指定病种的全部证型生成病案题列表
 */
export function generateCasesByDisease(dataset: CaseDataset, disease_id: string): CaseQuestion[] {
  const disease_syndromes = dataset.syndromes.filter((s) => s.disease_id === disease_id)
  return disease_syndromes.map((syndrome) => generateCaseQuestion(dataset, syndrome))
}

/**
 * 随机生成 N 道病案题（从不同病种中抽取）
 */
export function generateRandomCases(dataset: CaseDataset, count: number): CaseQuestion[] {
  const disease_ids = [...new Set(dataset.syndromes.map((s) => s.disease_id))]
  const shuffled_disease_ids = disease_ids.sort(() => Math.random() - 0.5)
  const picked: Syndrome[] = []

  for (const disease_id of shuffled_disease_ids) {
    if (picked.length >= count) break
    const candidates = dataset.syndromes.filter((s) => s.disease_id === disease_id)
    if (candidates.length === 0) continue
    picked.push(pickOne(candidates))
  }

  // 不足时补充
  while (picked.length < count) {
    picked.push(pickOne(dataset.syndromes))
  }

  return picked.map((syndrome) => generateCaseQuestion(dataset, syndrome))
}

/**
 * 为全部证型各生成一道病案题（全量生成，用于浏览模式）
 */
export function generateAllCases(dataset: CaseDataset): CaseQuestion[] {
  return dataset.syndromes.map((syndrome) => generateCaseQuestion(dataset, syndrome))
}
