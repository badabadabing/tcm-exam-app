import Dexie, { type Table } from 'dexie'
import type { AnswerRecord, Bookmark, CaseAnswerRecord } from '../types'

export interface MetaEntry {
  key: string
  value: string
}

export class TcmDatabase extends Dexie {
  answer_records!: Table<AnswerRecord, string>
  bookmarks!: Table<Bookmark, string>
  case_answer_records!: Table<CaseAnswerRecord, string>
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
  }
}

export const db = new TcmDatabase()
