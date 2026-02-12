import type { AnswerRecord, Bookmark, CaseAnswerRecord, NoteEntry } from '../types'
import { db } from './db'

const ANSWER_RECORDS_KEY = 'tcm_answer_records'
const BOOKMARKS_KEY = 'tcm_bookmarks'
const MIGRATION_META_KEY = 'local_storage_migrated_v1'

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
