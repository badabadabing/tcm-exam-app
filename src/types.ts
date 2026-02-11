export type Category = '内科' | '外科' | '妇科' | '儿科' | '其他'

export type QuestionType = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6'

export interface SymptomItem {
  text: string
  is_key: boolean
}

export interface Syndrome {
  syndrome_id: string
  disease_id: string
  syndrome_name: string
  symptoms: {
    full_text: string
    items: SymptomItem[]
  }
  pathogenesis: string
  treatment_method: string
  prescription: {
    primary: string
    alternative: string | null
  }
  key_symptom_analysis: string[]
}

export interface Disease {
  disease_id: string
  disease_name: string
  key_symptoms: string
  key_pulse: string
  category: Category
  related_diseases: string[]
  syndromes: string[]
}

export interface QuestionTemplate {
  question_type: QuestionType
  template: string
}

export interface QuestionOption {
  key: string
  text: string
}

export interface Explanation {
  correct_answer: string
  key_symptom_analysis: string[]
  pathogenesis: string
  treatment_method: string
  prescription: string
  full_symptoms: string
}

export interface Question {
  id: string
  question_type: QuestionType
  stem: string
  options: QuestionOption[]
  correct_index: number
  syndrome_id: string
  disease_id: string
  explanation: Explanation
}

export interface AnswerRecord {
  id: string
  question_id: string
  syndrome_id: string
  disease_id: string
  question_type: QuestionType
  user_answer: string
  is_correct: boolean
  timestamp: number
  duration_ms: number
}

export interface Bookmark {
  id: string
  question_id: string
  syndrome_id: string
  question_type: QuestionType
  question_snapshot: Question
  created_at: number
}

/* ──── 病案论述题 ──── */

export interface CaseStandardAnswer {
  disease_name: string
  syndrome_name: string
  diagnosis_text: string
  pathogenesis: string
  treatment_method: string
  prescription: string
  key_symptom_analysis: string[]
  full_symptoms: string
}

export interface CaseQuestion {
  id: string
  syndrome_id: string
  disease_id: string
  case_text: string
  standard_answer: CaseStandardAnswer
}

export type CaseSelfRating = 'mastered' | 'partial' | 'failed'

export interface CaseAnswerRecord {
  case_id: string
  syndrome_id: string
  disease_id: string
  self_rating: CaseSelfRating
}

export interface CaseExamSummary {
  reason: 'completed' | 'manual_submit' | 'time_up'
  total: number
  reviewed: number
  mastered: number
  partial: number
  failed: number
  used_seconds: number
  finished_at: number
  cases: CaseQuestion[]
  ratings: Record<string, CaseSelfRating>
}
