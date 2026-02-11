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
