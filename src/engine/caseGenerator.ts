/**
 * 病案论述题生成引擎
 *
 * 将每个证型转换为标准病案（临床模拟题），包含：
 * - 符合性别/年龄约束的患者信息
 * - 从症状数据自动分离的舌诊、脉诊
 * - 自然语言的病案叙述
 * - 标准答案（诊断、病机、治法、方药）
 */

import type { CaseQuestion, CaseStandardAnswer, Disease, Syndrome, SymptomItem } from '../types'
import { sampleSymptoms } from './symptomSampler'
import {
  pickOne,
  randomInt,
  sampleDurationByAcuity,
  sampleGender,
  sampleSurname,
} from '../utils/random'

/* ──── 性别 / 年龄约束 ──── */

/** 妇科疾病 ID 集合 */
const FEMALE_ONLY_DISEASE_IDS = new Set([
  'D036', // 乳癖
  'D042', // 崩漏
  'D043', // 闭经
  'D044', // 痛经
  'D045', // 绝经前后诸证
  'D046', // 带下病
  'D047', // 胎漏、胎动不安
  'D048', // 产后发热
  'D049', // 不孕症
  'D050', // 癥瘕
])

/** 男性特有疾病 ID 集合 */
const MALE_ONLY_DISEASE_IDS = new Set([
  'D040', // 精癃（前列腺增生）
])

/** 儿科疾病 ID 集合 */
const PEDIATRIC_DISEASE_IDS = new Set([
  'D051', // 肺炎喘嗽
  'D052', // 小儿泄泻
  'D053', // 积滞
  'D054', // 鹅口疮
  'D055', // 水痘
  'D056', // 痄腮
  'D057', // 手足口病
  'D058', // 麻疹
  'D059', // 紫癜
])

/** 各妇科疾病的年龄范围 */
const FEMALE_AGE_RANGES: Record<string, [number, number]> = {
  D036: [25, 50],  // 乳癖
  D042: [18, 50],  // 崩漏
  D043: [16, 42],  // 闭经
  D044: [14, 45],  // 痛经
  D045: [45, 55],  // 绝经前后诸证
  D046: [20, 50],  // 带下病
  D047: [23, 38],  // 胎漏、胎动不安
  D048: [23, 38],  // 产后发热
  D049: [24, 38],  // 不孕症
  D050: [25, 50],  // 癥瘕
}

/** 儿科疾病的年龄范围（月龄区间 / 岁区间） */
interface PediatricAgeRange {
  min_months: number
  max_months: number
}

const PEDIATRIC_AGE_RANGES: Record<string, PediatricAgeRange> = {
  D051: { min_months: 2, max_months: 72 },    // 肺炎喘嗽：2月~6岁
  D052: { min_months: 3, max_months: 36 },    // 小儿泄泻：3月~3岁
  D053: { min_months: 6, max_months: 72 },    // 积滞：6月~6岁
  D054: { min_months: 1, max_months: 12 },    // 鹅口疮：新生儿~1岁
  D055: { min_months: 12, max_months: 120 },  // 水痘：1~10岁
  D056: { min_months: 36, max_months: 144 },  // 痄腮：3~12岁
  D057: { min_months: 6, max_months: 60 },    // 手足口病：6月~5岁
  D058: { min_months: 6, max_months: 60 },    // 麻疹：6月~5岁
  D059: { min_months: 24, max_months: 144 },  // 紫癜：2~12岁
}

interface PatientDemographics {
  surname: string
  gender: '男' | '女'
  age: number
  age_unit: '岁' | '个月'
  /** 额外身份描述，如 "孕28周" "产后5天" */
  extra_context: string
}

function isFemaleOnlyByName(disease_name: string): boolean {
  return /[经带胎产孕]|不孕|癥瘕|乳癖/.test(disease_name)
}

function isMaleOnlyByName(disease_name: string): boolean {
  return /精癃/.test(disease_name)
}

function resolveGender(disease: Disease): '男' | '女' {
  if (FEMALE_ONLY_DISEASE_IDS.has(disease.disease_id) || isFemaleOnlyByName(disease.disease_name)) {
    return '女'
  }
  if (MALE_ONLY_DISEASE_IDS.has(disease.disease_id) || isMaleOnlyByName(disease.disease_name)) {
    return '男'
  }
  return sampleGender(false)
}

function resolveDemographics(disease: Disease): PatientDemographics {
  const surname = sampleSurname()
  let extra_context = ''

  // 儿科
  if (PEDIATRIC_DISEASE_IDS.has(disease.disease_id)) {
    const range = PEDIATRIC_AGE_RANGES[disease.disease_id] ?? { min_months: 6, max_months: 120 }
    const months = randomInt(range.min_months, range.max_months)
    const gender = sampleGender(false)
    if (months < 12) {
      return { surname, gender, age: months, age_unit: '个月', extra_context: '' }
    }
    return { surname, gender, age: Math.floor(months / 12), age_unit: '岁', extra_context: '' }
  }

  const gender = resolveGender(disease)

  // 妇科特殊年龄
  if (FEMALE_ONLY_DISEASE_IDS.has(disease.disease_id)) {
    const range = FEMALE_AGE_RANGES[disease.disease_id] ?? [20, 50]
    const age = randomInt(range[0], range[1])

    // 孕期相关
    if (disease.disease_id === 'D047') {
      const weeks = randomInt(8, 32)
      extra_context = `孕${weeks}周`
    }
    // 产后
    if (disease.disease_id === 'D048') {
      const days = randomInt(2, 14)
      extra_context = `产后${days}天`
    }
    // 不孕
    if (disease.disease_id === 'D049') {
      const years = randomInt(1, 5)
      extra_context = `婚后${years}年未孕`
    }
    return { surname, gender, age, age_unit: '岁', extra_context }
  }

  // 精癃（老年男性）
  if (disease.disease_id === 'D040') {
    return { surname, gender: '男', age: randomInt(55, 78), age_unit: '岁', extra_context: '' }
  }

  // 普通内科 / 外科
  const age = randomInt(22, 72)
  return { surname, gender, age, age_unit: '岁', extra_context }
}

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

/* ──── 病程 / 主诉推断 ──── */

type DiseaseAcuity = 'acute' | 'subacute' | 'chronic' | 'chronic_flare'

/** 急性疾病 */
const ACUTE_DISEASE_IDS = new Set([
  'D001', // 感冒
  'D015', // 痢疾
  'D041', // 肠痈
  'D048', // 产后发热
  'D051', // 肺炎喘嗽
  'D052', // 小儿泄泻
  'D054', // 鹅口疮
  'D055', // 水痘
  'D056', // 痄腮
  'D057', // 手足口病
  'D058', // 麻疹
])

/** 慢性反复发作类疾病 */
const CHRONIC_FLARE_DISEASE_IDS = new Set([
  'D003', // 哮病
  'D006', // 肺胀
  'D007', // 心悸
  'D008', // 胸痹
  'D011', // 胃痛
  'D033', // 痹证
  'D044', // 痛经
])

/** 慢性疾病 */
const CHRONIC_DISEASE_IDS = new Set([
  'D005', // 肺痨
  'D009', // 不寐
  'D010', // 痫病
  'D019', // 鼓胀
  'D022', // 中风
  'D023', // 痴呆
  'D024', // 颤证
  'D025', // 水肿
  'D029', // 消渴
  'D030', // 瘿病
  'D034', // 痿证
  'D035', // 腰痛
  'D036', // 乳癖
  'D039', // 脱疽
  'D040', // 精癃
  'D042', // 崩漏
  'D043', // 闭经
  'D045', // 绝经前后诸证
  'D049', // 不孕症
  'D050', // 癥瘕
])

function getDiseaseAcuity(disease_id: string): DiseaseAcuity {
  if (ACUTE_DISEASE_IDS.has(disease_id)) return 'acute'
  if (CHRONIC_FLARE_DISEASE_IDS.has(disease_id)) return 'chronic_flare'
  if (CHRONIC_DISEASE_IDS.has(disease_id)) return 'chronic'
  return 'subacute'
}

/**
 * 从 key_symptoms 生成主诉文字
 * 例："恶寒、发热" + "3天" → "恶寒发热3天"
 */
function buildChiefComplaint(disease: Disease, duration: string, extra_context: string): string {
  // 把顿号去掉，拼成紧凑的主诉
  const key = disease.key_symptoms.replace(/[、，,]/g, '').replace(/\s+/g, '')
  const trimmed = key.length > 12 ? key.slice(0, 12) : key
  const context_prefix = extra_context ? `${extra_context}，` : ''
  return `${context_prefix}${trimmed}${duration}`
}

/* ──── 季节推断 ──── */

function resolveSeason(syndrome_name: string, disease_id: string): string | null {
  if (syndrome_name.includes('暑湿') || syndrome_name.includes('暑热')) return '夏季'
  if (syndrome_name.includes('风寒')) return pickOne(['冬季', '初春', '深秋'])
  if (syndrome_name.includes('风热')) return pickOne(['春季', '夏初'])
  if (syndrome_name.includes('凉燥') || syndrome_name.includes('温燥')) return '秋季'
  // 传染病常有季节
  if (disease_id === 'D055') return pickOne(['冬季', '春季']) // 水痘
  if (disease_id === 'D058') return pickOne(['冬末', '春季']) // 麻疹
  if (disease_id === 'D057') return pickOne(['夏季', '初秋']) // 手足口
  return null
}

/* ──── 病案正文生成 ──── */

function buildCaseText(
  demographics: PatientDemographics,
  disease: Disease,
  syndrome: Syndrome,
  sampled_items: SymptomItem[],
): string {
  const { surname, gender, age, age_unit, extra_context } = demographics
  const is_pediatric = PEDIATRIC_DISEASE_IDS.has(disease.disease_id)
  const acuity = getDiseaseAcuity(disease.disease_id)
  const duration = sampleDurationByAcuity(acuity)
  const season = resolveSeason(syndrome.syndrome_name, disease.disease_id)

  // 分离主症 / 舌 / 脉
  const { main_symptoms, tongue_items, pulse_items } = splitSymptomItems(sampled_items)
  const main_text = main_symptoms.map((item) => item.text).join('，')
  const tongue_text = tongue_items.map((item) => item.text).join('，')
  const pulse_text = pulse_items.map((item) => item.text).join('，')

  // 主诉
  const chief_complaint = buildChiefComplaint(disease, duration, extra_context)

  // 称谓
  const title = is_pediatric ? '患儿' : ''
  const name_part = `${surname}某，${gender}，${age}${age_unit}`
  const season_part = season ? `${season}来诊。` : ''

  // 组装病案
  const parts: string[] = []

  if (is_pediatric && title) {
    parts.push(`${title}${surname}某，${gender}，${age}${age_unit}。`)
  } else {
    parts.push(`${name_part}。`)
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

  const demographics = resolveDemographics(disease)

  // 采样症状（保留全部关键症状 + 随机部分非关键症状）
  const { sampled_items } = sampleSymptoms(syndrome.symptoms.items)

  const case_text = buildCaseText(demographics, disease, syndrome, sampled_items)
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
  // 优先从不同病种中各选一个证型，保证多样性
  const disease_ids = [...new Set(dataset.syndromes.map((s) => s.disease_id))]
  const shuffled_disease_ids = disease_ids.sort(() => Math.random() - 0.5)
  const picked: Syndrome[] = []
  const used_diseases = new Set<string>()

  for (const disease_id of shuffled_disease_ids) {
    if (picked.length >= count) break
    const candidates = dataset.syndromes.filter((s) => s.disease_id === disease_id)
    if (candidates.length === 0) continue
    picked.push(pickOne(candidates))
    used_diseases.add(disease_id)
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
