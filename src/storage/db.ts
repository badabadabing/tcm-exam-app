import Dexie, { type Table } from 'dexie'
import type { AnswerRecord, Bookmark, CaseAnswerRecord, NoteEntry } from '../types'

export interface MetaEntry {
  key: string
  value: string
}

export class TcmDatabase extends Dexie {
  answer_records!: Table<AnswerRecord, string>
  bookmarks!: Table<Bookmark, string>
  case_answer_records!: Table<CaseAnswerRecord, string>
  notes!: Table<NoteEntry, string>
  meta!: Table<MetaEntry, string>

  constructor() {
    super('tcm_exam_db')
    this.version(1).stores({
      answer_records: 'id, timestamp, disease_id, syndrome_id, question_type, is_correct',
      bookmarks: 'id, created_at, syndrome_id, question_type, question_id',
      meta: 'key',
    })
    this.version(2).stores({
      answer_records: 'id, timestamp, disease_id, syndrome_id, question_type, is_correct',
      bookmarks: 'id, created_at, syndrome_id, question_type, question_id',
      case_answer_records: 'id, timestamp, disease_id, syndrome_id, self_rating, mode',
      meta: 'key',
    })
    this.version(3).stores({
      answer_records: 'id, timestamp, disease_id, syndrome_id, question_type, is_correct, next_review_date, repetition',
      bookmarks: 'id, created_at, syndrome_id, question_type, question_id',
      case_answer_records: 'id, timestamp, disease_id, syndrome_id, self_rating, mode',
      notes: 'id, timestamp, target_type, target_id',
      meta: 'key',
    })
  }
}

export const db = new TcmDatabase()
