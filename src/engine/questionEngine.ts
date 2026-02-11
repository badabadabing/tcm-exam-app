import { generateDistractors, type DistractorField } from './distractorGenerator'
import { sampleSymptoms } from './symptomSampler'
import type { Disease, Question, QuestionOption, QuestionType, Syndrome } from '../types'
import { pickManyUnique, pickOne, randomInt, sampleDuration, sampleGender, sampleSeason, shuffle } from '../utils/random'

export interface QuestionDataset {
  diseases: Disease[]
  syndromes: Syndrome[]
}

function getDiseaseName(diseases: Disease[], disease_id: string): string {
  return diseases.find((item) => item.disease_id === disease_id)?.disease_name ?? '未知病种'
}

function isFemaleDiseaseName(name: string): boolean {
  return name.includes('经') || name.includes('带') || name.includes('胎')
}

function createOptions(correct: string, distractors: string[]): { options: QuestionOption[]; correct_index: number } {
  const all_options = shuffle([correct, ...distractors]).slice(0, 5)
  const options = all_options.map((text, index) => ({
    key: String.fromCharCode(65 + index),
    text,
  }))
  const correct_index = all_options.findIndex((item) => item === correct)
  return { options, correct_index }
}

function buildCasePrefix(diseases: Disease[], syndrome: Syndrome, symptom_display: string): string {
  const disease_name = getDiseaseName(diseases, syndrome.disease_id)
  const duration = sampleDuration()
  const age = randomInt(18, 75)
  const gender = sampleGender(isFemaleDiseaseName(disease_name))
  const season = sampleSeason(syndrome.syndrome_name.includes('暑湿'))
  return `患者，${gender}，${age}岁。${disease_name}相关症状${duration}，${season}发病。现症见：${symptom_display}。`
}

function buildExplanation(syndrome: Syndrome, correct_answer: string) {
  const secondary = syndrome.prescription.alternative ? `（或${syndrome.prescription.alternative}）` : ''
  return {
    correct_answer,
    key_symptom_analysis: syndrome.key_symptom_analysis,
    pathogenesis: syndrome.pathogenesis,
    treatment_method: syndrome.treatment_method,
    prescription: `${syndrome.prescription.primary}${secondary}`,
    full_symptoms: syndrome.symptoms.full_text,
  }
}

function generateByType(dataset: QuestionDataset, syndrome: Syndrome, question_type: QuestionType): Question {
  const disease_name = getDiseaseName(dataset.diseases, syndrome.disease_id)
  const { sampled_text } = sampleSymptoms(syndrome.symptoms.items)
  const case_prefix = buildCasePrefix(dataset.diseases, syndrome, sampled_text)

  let stem = ''
  let correct_answer = ''
  let distractor_field: DistractorField = 'syndrome_name'

  if (question_type === 'Q1') {
    stem = `${case_prefix}该患者最可能的证型是：`
    correct_answer = syndrome.syndrome_name
    distractor_field = 'syndrome_name'
  } else if (question_type === 'Q2') {
    stem = `${case_prefix}该患者的治法是：`
    correct_answer = syndrome.treatment_method
    distractor_field = 'treatment_method'
  } else if (question_type === 'Q3') {
    stem = `${case_prefix}该患者的首选方剂是：`
    correct_answer = syndrome.prescription.primary
    distractor_field = 'prescription'
  } else if (question_type === 'Q4') {
    stem = `${disease_name}·${syndrome.syndrome_name}的证机概要是：`
    correct_answer = syndrome.pathogenesis
    distractor_field = 'pathogenesis'
  } else if (question_type === 'Q5') {
    stem = `方剂“${syndrome.prescription.primary}”对应的${disease_name}证型是：`
    correct_answer = syndrome.syndrome_name
    distractor_field = 'syndrome_name'
  } else {
    stem = `${disease_name}的治法为“${syndrome.treatment_method}”，应首选哪个方剂？`
    correct_answer = syndrome.prescription.primary
    distractor_field = 'prescription'
  }

  const distractors = generateDistractors(
    dataset.diseases,
    dataset.syndromes,
    syndrome.syndrome_id,
    distractor_field,
    correct_answer,
    4,
  )
  const { options, correct_index } = createOptions(correct_answer, distractors)

  return {
    id: `${syndrome.syndrome_id}_${question_type}_${Date.now()}_${randomInt(1000, 9999)}`,
    question_type,
    stem,
    options,
    correct_index,
    syndrome_id: syndrome.syndrome_id,
    disease_id: syndrome.disease_id,
    explanation: buildExplanation(syndrome, correct_answer),
  }
}

export function generateQuestion(dataset: QuestionDataset, syndrome_id: string, question_type?: QuestionType): Question {
  const syndrome = dataset.syndromes.find((item) => item.syndrome_id === syndrome_id)
  if (!syndrome) {
    throw new Error(`证型不存在: ${syndrome_id}`)
  }

  const all_types: QuestionType[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']
  const picked_type = question_type ?? pickOne(all_types)
  return generateByType(dataset, syndrome, picked_type)
}

export function generateByDisease(
  dataset: QuestionDataset,
  disease_id: string,
  count: number,
  type_filter: QuestionType[] = [],
): Question[] {
  const disease_syndromes = dataset.syndromes.filter((item) => item.disease_id === disease_id)
  if (!disease_syndromes.length) {
    return []
  }

  const allowed_types: QuestionType[] = type_filter.length ? type_filter : ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']
  const results: Question[] = []

  // 先保证每个证型至少覆盖1题
  for (const syndrome of disease_syndromes) {
    const type = pickOne(allowed_types)
    results.push(generateByType(dataset, syndrome, type))
    if (results.length >= count) {
      return results
    }
  }

  // 不足部分随机补齐
  while (results.length < count) {
    const syndrome = pickOne(disease_syndromes)
    const type = pickOne(allowed_types)
    results.push(generateByType(dataset, syndrome, type))
  }

  return results
}

export function generateRandom(dataset: QuestionDataset, count: number, type_filter: QuestionType[] = []): Question[] {
  const allowed_types: QuestionType[] = type_filter.length ? type_filter : ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']
  const selected_syndromes = pickManyUnique(dataset.syndromes, Math.min(count, dataset.syndromes.length))
  const results: Question[] = selected_syndromes.map((item) => generateByType(dataset, item, pickOne(allowed_types)))

  while (results.length < count) {
    const syndrome = pickOne(dataset.syndromes)
    results.push(generateByType(dataset, syndrome, pickOne(allowed_types)))
  }

  return results
}
