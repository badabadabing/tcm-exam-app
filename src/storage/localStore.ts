import type { AnswerRecord, Bookmark, CaseAnswerRecord, NoteEntry } from '../types'
import { db } from './db'

const ANSWER_RECORDS_KEY = 'tcm_answer_records'
const BOOKMARKS_KEY = 'tcm_bookmarks'
const MIGRATION_META_KEY = 'local_storage_migrated_v1'
const BACKUP_SCHEMA_VERSION = 1

export interface LearningBackupPayload {
  schema_version: number
  exported_at: number
  data: {
    answer_records: AnswerRecord[]
    bookmarks: Bookmark[]
    case_answer_records: CaseAnswerRecord[]
    notes: NoteEntry[]
    meta: Array<{ key: string; value: string }>
  }
}

let init_task: Promise<void> | null = null

function readLegacyJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toBookmarkWithQuestionId(bookmark: Bookmark | Omit<Bookmark, 'question_id'>): Bookmark {
  return {
    ...bookmark,
    question_id: bookmark.question_snapshot.id,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isAnswerRecord(value: unknown): value is AnswerRecord {
  if (!isObject(value)) {
    return false
  }
  return (
    isString(value.id)
    && isString(value.question_id)
    && isString(value.syndrome_id)
    && isString(value.disease_id)
    && isString(value.question_type)
    && isString(value.user_answer)
    && typeof value.is_correct === 'boolean'
    && isNumber(value.timestamp)
    && isNumber(value.duration_ms)
  )
}

function isBookmark(value: unknown): value is Bookmark {
  if (!isObject(value)) {
    return false
  }
  return (
    isString(value.id)
    && isString(value.syndrome_id)
    && isString(value.question_type)
    && isNumber(value.created_at)
    && isObject(value.question_snapshot)
  )
}

function isCaseAnswerRecord(value: unknown): value is CaseAnswerRecord {
  if (!isObject(value)) {
    return false
  }
  return (
    isString(value.id)
    && isString(value.case_id)
    && isString(value.syndrome_id)
    && isString(value.disease_id)
    && isString(value.self_rating)
    && isString(value.diagnosis_text)
    && isString(value.pathogenesis_text)
    && isString(value.treatment_text)
    && isString(value.prescription_text)
    && isString(value.mode)
    && isNumber(value.timestamp)
  )
}

function isNoteEntry(value: unknown): value is NoteEntry {
  if (!isObject(value)) {
    return false
  }
  return (
    isString(value.id)
    && isString(value.target_type)
    && isString(value.target_id)
    && isString(value.content)
    && isNumber(value.timestamp)
  )
}

function isMetaEntry(value: unknown): value is { key: string; value: string } {
  if (!isObject(value)) {
    return false
  }
  return isString(value.key) && isString(value.value)
}

function parseBackupPayload(payload: unknown): LearningBackupPayload {
  if (!isObject(payload)) {
    throw new Error('备份文件不是有效 JSON 对象。')
  }
  if (payload.schema_version !== BACKUP_SCHEMA_VERSION) {
    throw new Error('备份版本不受支持，请升级应用后再导入。')
  }
  if (!isNumber(payload.exported_at)) {
    throw new Error('备份文件缺少导出时间。')
  }
  if (!isObject(payload.data)) {
    throw new Error('备份文件缺少 data 节点。')
  }

  const {
    answer_records,
    bookmarks,
    case_answer_records,
    notes,
    meta,
  } = payload.data

  if (!Array.isArray(answer_records) || !answer_records.every((item) => isAnswerRecord(item))) {
    throw new Error('备份中的 answer_records 格式不正确。')
  }
  if (!Array.isArray(bookmarks) || !bookmarks.every((item) => isBookmark(item))) {
    throw new Error('备份中的 bookmarks 格式不正确。')
  }
  if (!Array.isArray(case_answer_records) || !case_answer_records.every((item) => isCaseAnswerRecord(item))) {
    throw new Error('备份中的 case_answer_records 格式不正确。')
  }
  if (!Array.isArray(notes) || !notes.every((item) => isNoteEntry(item))) {
    throw new Error('备份中的 notes 格式不正确。')
  }
  if (!Array.isArray(meta) || !meta.every((item) => isMetaEntry(item))) {
    throw new Error('备份中的 meta 格式不正确。')
  }

  return {
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: payload.exported_at,
    data: {
      answer_records,
      bookmarks: bookmarks.map((item) => toBookmarkWithQuestionId(item)),
      case_answer_records,
      notes,
      meta,
    },
  }
}

async function migrateFromLocalStorageIfNeeded(): Promise<void> {
  const migrated = await db.meta.get(MIGRATION_META_KEY)
  if (migrated?.value === '1') {
    return
  }

  const legacy_records = readLegacyJson<AnswerRecord[]>(ANSWER_RECORDS_KEY, [])
  const legacy_bookmarks = readLegacyJson<Array<Bookmark | Omit<Bookmark, 'question_id'>>>(BOOKMARKS_KEY, [])

  await db.transaction('rw', db.answer_records, db.bookmarks, db.meta, async () => {
    if (legacy_records.length > 0) {
      await db.answer_records.bulkPut(legacy_records)
    }

    if (legacy_bookmarks.length > 0) {
      const normalized_bookmarks = legacy_bookmarks.map((item) => toBookmarkWithQuestionId(item))
      await db.bookmarks.bulkPut(normalized_bookmarks)
    }

    await db.meta.put({ key: MIGRATION_META_KEY, value: '1' })
  })
}

export async function initStorage(): Promise<void> {
  if (!init_task) {
    init_task = migrateFromLocalStorageIfNeeded().catch((error) => {
      init_task = null
      throw error
    })
  }
  await init_task
}

export async function getAnswerRecords(): Promise<AnswerRecord[]> {
  await initStorage()
  return db.answer_records.orderBy('timestamp').reverse().toArray()
}

export async function saveAnswerRecord(record: AnswerRecord): Promise<void> {
  await initStorage()
  await db.answer_records.put(record)
}

export async function getBookmarks(): Promise<Bookmark[]> {
  await initStorage()
  return db.bookmarks.orderBy('created_at').reverse().toArray()
}

export async function getUserId(): Promise<string> {
  await initStorage()
  const entry = await db.meta.get('user_id')
  if (entry) {
    return entry.value
  }
  const id = crypto.randomUUID()
  await db.meta.put({ key: 'user_id', value: id })
  return id
}

export async function getCaseAnswerRecords(): Promise<CaseAnswerRecord[]> {
  await initStorage()
  return db.case_answer_records.orderBy('timestamp').reverse().toArray()
}

export async function saveCaseAnswerRecord(record: CaseAnswerRecord): Promise<void> {
  await initStorage()
  await db.case_answer_records.put(record)
}

export async function getNotes(): Promise<NoteEntry[]> {
  await initStorage()
  return db.notes.orderBy('timestamp').reverse().toArray()
}

export async function saveNote(note: NoteEntry): Promise<void> {
  await initStorage()
  await db.notes.put(note)
}

export async function deleteNote(note_id: string): Promise<void> {
  await initStorage()
  await db.notes.delete(note_id)
}

export async function toggleBookmark(bookmark: Bookmark): Promise<void> {
  await initStorage()
  const normalized = toBookmarkWithQuestionId(bookmark)
  const existing = await db.bookmarks.where('question_id').equals(normalized.question_id).first()
  if (existing) {
    await db.bookmarks.delete(existing.id)
    return
  }
  await db.bookmarks.put(normalized)
}

export async function setMetaJson<T>(key: string, value: T): Promise<void> {
  await initStorage()
  await db.meta.put({ key, value: JSON.stringify(value) })
}

export async function getMetaJson<T>(key: string, fallback: T): Promise<T> {
  await initStorage()
  const item = await db.meta.get(key)
  if (!item) {
    return fallback
  }
  try {
    return JSON.parse(item.value) as T
  } catch {
    return fallback
  }
}

export async function exportLearningBackup(): Promise<LearningBackupPayload> {
  await initStorage()
  const [answer_records, bookmarks, case_answer_records, notes, meta] = await Promise.all([
    db.answer_records.toArray(),
    db.bookmarks.toArray(),
    db.case_answer_records.toArray(),
    db.notes.toArray(),
    db.meta.toArray(),
  ])

  return {
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: Date.now(),
    data: {
      answer_records,
      bookmarks,
      case_answer_records,
      notes,
      meta,
    },
  }
}

export async function importLearningBackup(payload: unknown): Promise<void> {
  await initStorage()
  const parsed = parseBackupPayload(payload)
  const next_meta = [
    ...parsed.data.meta.filter((item) => item.key !== MIGRATION_META_KEY),
    { key: MIGRATION_META_KEY, value: '1' },
  ]

  await db.transaction('rw', [db.answer_records, db.bookmarks, db.case_answer_records, db.notes, db.meta], async () => {
    await db.answer_records.clear()
    await db.bookmarks.clear()
    await db.case_answer_records.clear()
    await db.notes.clear()
    await db.meta.clear()

    if (parsed.data.answer_records.length > 0) {
      await db.answer_records.bulkPut(parsed.data.answer_records)
    }
    if (parsed.data.bookmarks.length > 0) {
      await db.bookmarks.bulkPut(parsed.data.bookmarks)
    }
    if (parsed.data.case_answer_records.length > 0) {
      await db.case_answer_records.bulkPut(parsed.data.case_answer_records)
    }
    if (parsed.data.notes.length > 0) {
      await db.notes.bulkPut(parsed.data.notes)
    }
    if (next_meta.length > 0) {
      await db.meta.bulkPut(next_meta)
    }
  })
}
