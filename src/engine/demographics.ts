/**
 * 共享人口学模块
 *
 * 为选择题引擎（questionEngine）和病案题引擎（caseGenerator）提供统一的
 * 患者性别、年龄、病程、季节推断逻辑，确保题目中的患者信息与疾病类别一致：
 * - 儿科疾病 → 患儿，月龄或儿童年龄
 * - 妇科疾病 → 女性患者，疾病专属年龄段
 * - 男性专属疾病 → 男性患者，老年年龄
 * - 普通疾病 → 随机性别，22~72岁
 */

import type { Disease, Syndrome } from '../types'
import {
  pickOne,
  randomInt,
  sampleDurationByAcuity,
  sampleGender,
} from '../utils/random'

/* ──── 性别约束 ──── */

/** 女性专属疾病 ID 集合（妇科 + 乳癖） */
export const FEMALE_ONLY_DISEASE_IDS = new Set([
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

/** 男性专属疾病 ID 集合 */
export const MALE_ONLY_DISEASE_IDS = new Set([
  'D040', // 精癃（前列腺增生）
])

/** 儿科疾病 ID 集合 */
export const PEDIATRIC_DISEASE_IDS = new Set([
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

/* ──── 年龄范围 ──── */

/** 各妇科疾病的年龄范围 [min, max]（岁） */
export const FEMALE_AGE_RANGES: Record<string, [number, number]> = {
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

/** 儿科疾病的月龄范围 */
interface PediatricAgeRange {
  min_months: number
  max_months: number
}

export const PEDIATRIC_AGE_RANGES: Record<string, PediatricAgeRange> = {
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

/* ──── 病种急慢性分类 ──── */

type DiseaseAcuity = 'acute' | 'subacute' | 'chronic' | 'chronic_flare'

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

const CHRONIC_FLARE_DISEASE_IDS = new Set([
  'D003', // 哮病
  'D006', // 肺胀
  'D007', // 心悸
  'D008', // 胸痹
  'D011', // 胃痛
  'D033', // 痹证
  'D044', // 痛经
])

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

export function getDiseaseAcuity(disease_id: string): DiseaseAcuity {
  if (ACUTE_DISEASE_IDS.has(disease_id)) return 'acute'
  if (CHRONIC_FLARE_DISEASE_IDS.has(disease_id)) return 'chronic_flare'
  if (CHRONIC_DISEASE_IDS.has(disease_id)) return 'chronic'
  return 'subacute'
}

/* ──── 季节推断 ──── */

export function resolveSeason(syndrome_name: string, disease_id: string): string {
  if (syndrome_name.includes('暑湿') || syndrome_name.includes('暑热')) return '夏季'
  if (syndrome_name.includes('风寒')) return pickOne(['冬季', '初春', '深秋'])
  if (syndrome_name.includes('风热')) return pickOne(['春季', '夏初'])
  if (syndrome_name.includes('凉燥') || syndrome_name.includes('温燥')) return '秋季'
  if (disease_id === 'D055') return pickOne(['冬季', '春季']) // 水痘
  if (disease_id === 'D058') return pickOne(['冬末', '春季']) // 麻疹
  if (disease_id === 'D057') return pickOne(['夏季', '初秋']) // 手足口
  return pickOne(['春季', '夏季', '秋季', '冬季'])
}

/* ──── 性别推断 ──── */

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
  // 兜底：category 为妇科时强制女性
  if (disease.category === '妇科') {
    return '女'
  }
  return sampleGender(false)
}

/* ──── 对外导出的人口学接口 ──── */

export interface Demographics {
  gender: '男' | '女'
  age: number
  age_unit: '岁' | '个月'
  /** '患儿' 用于儿科，其余为 '患者' */
  title: '患者' | '患儿'
  /** 额外身份描述，如 "孕28周" "产后5天"，无则为空字符串 */
  extra_context: string
  duration: string
  season: string
}

/**
 * 根据疾病和证型信息推断符合临床实际的患者人口学信息。
 * 同时供选择题引擎和病案题引擎使用。
 */
export function resolveDemographics(disease: Disease, syndrome: Syndrome): Demographics {
  const acuity = getDiseaseAcuity(disease.disease_id)
  const duration = sampleDurationByAcuity(acuity)
  const season = resolveSeason(syndrome.syndrome_name, disease.disease_id)

  // ── 儿科 ──
  const isPediatric =
    PEDIATRIC_DISEASE_IDS.has(disease.disease_id) || disease.category === '儿科'

  if (isPediatric) {
    const range = PEDIATRIC_AGE_RANGES[disease.disease_id] ?? { min_months: 6, max_months: 120 }
    const months = randomInt(range.min_months, range.max_months)
    const gender = sampleGender(false)
    if (months < 12) {
      return { gender, age: months, age_unit: '个月', title: '患儿', extra_context: '', duration, season }
    }
    return { gender, age: Math.floor(months / 12), age_unit: '岁', title: '患儿', extra_context: '', duration, season }
  }

  const gender = resolveGender(disease)

  // ── 妇科专属 ──
  if (FEMALE_ONLY_DISEASE_IDS.has(disease.disease_id)) {
    const range = FEMALE_AGE_RANGES[disease.disease_id] ?? [20, 50]
    const age = randomInt(range[0], range[1])
    let extra_context = ''
    if (disease.disease_id === 'D047') extra_context = `孕${randomInt(8, 32)}周`
    if (disease.disease_id === 'D048') extra_context = `产后${randomInt(2, 14)}天`
    if (disease.disease_id === 'D049') extra_context = `婚后${randomInt(1, 5)}年未孕`
    return { gender, age, age_unit: '岁', title: '患者', extra_context, duration, season }
  }

  // ── 男性专属（精癃，老年） ──
  if (MALE_ONLY_DISEASE_IDS.has(disease.disease_id)) {
    return { gender: '男', age: randomInt(55, 78), age_unit: '岁', title: '患者', extra_context: '', duration, season }
  }

  // ── 普通内科/外科 ──
  const age = randomInt(22, 72)
  return { gender, age, age_unit: '岁', title: '患者', extra_context: '', duration, season }
}
