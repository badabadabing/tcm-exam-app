import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { loadDataset, type DatasetBundle } from './data/dataset'
import { generateCasesByDisease, generateRandomCases } from './engine/caseGenerator'
import { generateByDisease, generateQuestion, generateRandom } from './engine/questionEngine'
import { getAnswerRecords, getBookmarks, saveAnswerRecord, toggleBookmark } from './storage/localStore'
import type { AnswerRecord, Bookmark, CaseExamSummary, CaseQuestion, CaseSelfRating, Question, QuestionType } from './types'
import ShareCard, { type ShareCardData } from './components/ShareCard'
import { trackEvent, EVENTS } from './utils/analytics'
import { pickOne, randomInt, shuffle } from './utils/random'

type Tab = 'dashboard' | 'library' | 'practice' | 'review' | 'stats'
type SessionMode = 'practice' | 'exam' | 'case_exam' | 'case_practice'
type ExamFinishReason = 'completed' | 'manual_submit' | 'time_up'

interface SessionAnswerSummary {
  question_id: string
  question_type: QuestionType
  disease_id: string
  syndrome_id: string
  user_answer: string
  correct_answer: string
  is_correct: boolean
  auto_submitted: boolean
}

interface ExamSummary {
  reason: ExamFinishReason
  total: number
  answered: number
  correct: number
  accuracy: number
  used_seconds: number
  finished_at: number
  answers: SessionAnswerSummary[]
}

interface PracticeSummary {
  total: number
  correct: number
  accuracy: number
  used_seconds: number
}

const PRACTICE_QUESTION_SECONDS = 5 * 60
const CASE_EXAM_TOTAL_SECONDS = 60 * 60
const CASE_EXAM_QUESTION_COUNT = 2
const CASE_EXAM_PROMPTS = [
  '1. 请写出中医病名诊断与证型诊断。',
  '2. 请写出证机概要。',
  '3. 请写出治法。',
  '4. 请写出处方（方剂名称）。',
]

function getWeaknessStats(records: AnswerRecord[]) {
  const by_type = new Map<QuestionType, { correct: number; total: number }>()
  for (const type of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'] as QuestionType[]) {
    by_type.set(type, { correct: 0, total: 0 })
  }

  for (const record of records) {
    const current = by_type.get(record.question_type)
    if (!current) {
      continue
    }
    current.total += 1
    if (record.is_correct) {
      current.correct += 1
    }
  }

  return [...by_type.entries()].map(([question_type, value]) => ({
    question_type,
    accuracy: value.total ? Math.round((value.correct / value.total) * 100) : 0,
    total: value.total,
  }))
}

function getDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDisplayDate(date_key: string): string {
  return date_key.slice(5)
}

function now_timestamp(): number {
  return Date.now()
}

function create_record_id(): string {
  return `${now_timestamp()}_${randomInt(100000, 999999)}`
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remain_seconds = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remain_seconds).padStart(2, '0')}`
}

function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [search_text, setSearchText] = useState('')
  const [category_filter, setCategoryFilter] = useState<'全部' | '内科' | '外科' | '妇科' | '儿科' | '其他'>('全部')
  const [questions, setQuestions] = useState<Question[]>([])
  const [current_index, setCurrentIndex] = useState(0)
  const [selected_index, setSelectedIndex] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [session_mode, setSessionMode] = useState<SessionMode>('practice')
  const [exam_summary, setExamSummary] = useState<ExamSummary | null>(null)
  const [session_answers, setSessionAnswers] = useState<Record<string, SessionAnswerSummary>>({})
  const [session_started_at, setSessionStartedAt] = useState(0)
  const [started_at, setStartedAt] = useState(0)
  const [remaining_seconds, setRemainingSeconds] = useState(PRACTICE_QUESTION_SECONDS)
  const [records, setRecords] = useState<AnswerRecord[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [dataset_bundle, setDatasetBundle] = useState<DatasetBundle | null>(null)
  const [dataset_error, setDatasetError] = useState<string | null>(null)
  const [is_initializing, setIsInitializing] = useState(true)
  const [loading_progress, setLoadingProgress] = useState(0)
  const [loading_text, setLoadingText] = useState('正在初始化应用')
  const [is_prefetching_sessions, setIsPrefetchingSessions] = useState(false)
  const [prefetched_random_session, setPrefetchedRandomSession] = useState<Question[] | null>(null)
  const [prefetched_q1_session, setPrefetchedQ1Session] = useState<Question[] | null>(null)
  const [trend_mode, setTrendMode] = useState<'count' | 'accuracy'>('count')
  const [library_sort, setLibrarySort] = useState<'default' | 'accuracy_desc' | 'accuracy_asc' | 'progress_desc' | 'progress_asc'>('default')
  const [review_type_filter, setReviewTypeFilter] = useState<'全部' | QuestionType>('全部')
  const [review_disease_filter, setReviewDiseaseFilter] = useState<'全部' | string>('全部')

  // ── 病案论述题状态 ──
  const [case_questions, setCaseQuestions] = useState<CaseQuestion[]>([])
  const [case_index, setCaseIndex] = useState(0)
  const [case_answer_visible, setCaseAnswerVisible] = useState(false)
  const [case_ratings, setCaseRatings] = useState<Record<string, CaseSelfRating>>({})
  const [case_exam_summary, setCaseExamSummary] = useState<CaseExamSummary | null>(null)
  const [practice_summary, setPracticeSummary] = useState<PracticeSummary | null>(null)
  const [share_card_data, setShareCardData] = useState<ShareCardData | null>(null)

  const diseases = useMemo(() => dataset_bundle?.diseases ?? [], [dataset_bundle])
  const syndromes = useMemo(() => dataset_bundle?.syndromes ?? [], [dataset_bundle])

  const current_question = questions[current_index]
  const current_case = case_questions[case_index] ?? null
  const progress = questions.length ? `${current_index + 1}/${questions.length}` : '0/0'
  const case_progress = case_questions.length ? `${case_index + 1}/${case_questions.length}` : '0/0'
  const is_exam_running = (session_mode === 'exam' && exam_summary === null) || (session_mode === 'case_exam' && case_exam_summary === null)
  const is_case_mode = session_mode === 'case_exam' || session_mode === 'case_practice'
  const disease_name_by_id = useMemo(() => {
    return new Map(diseases.map((item) => [item.disease_id, item.disease_name]))
  }, [diseases])

  const overview_stats = useMemo(() => {
    let correct_total = 0
    const wrong_records: AnswerRecord[] = []
    const covered_syndrome_set = new Set<string>()
    for (const item of records) {
      covered_syndrome_set.add(item.syndrome_id)
      if (item.is_correct) {
        correct_total += 1
      } else {
        wrong_records.push(item)
      }
    }
    return {
      correct_total,
      wrong_records,
      covered_syndromes: covered_syndrome_set.size,
      accuracy: records.length ? Math.round((correct_total / records.length) * 100) : 0,
    }
  }, [records])

  const today_stats = useMemo(() => {
    const today_key = getDateKey(Date.now())
    let count = 0
    let correct = 0
    for (const item of records) {
      if (getDateKey(item.timestamp) === today_key) {
        count += 1
        if (item.is_correct) correct += 1
      }
    }
    return { count, correct, accuracy: count ? Math.round((correct / count) * 100) : 0 }
  }, [records])

  const streak_days = useMemo(() => {
    if (records.length === 0) return 0
    const day_set = new Set<string>()
    for (const item of records) {
      day_set.add(getDateKey(item.timestamp))
    }
    let streak = 0
    const d = new Date()
    // 从今天往回数连续天数
    while (true) {
      const key = getDateKey(d.getTime())
      if (day_set.has(key)) {
        streak += 1
        d.setDate(d.getDate() - 1)
      } else {
        break
      }
    }
    return streak
  }, [records])

  const type_stats = useMemo(() => getWeaknessStats(records), [records])
  const weak_types = useMemo(() => {
    return type_stats.filter((item) => item.total > 0 && item.accuracy < 60)
  }, [type_stats])
  const wrong_records = overview_stats.wrong_records

  const daily_trend = useMemo(() => {
    const today = new Date()
    const days = Array.from({ length: 7 }).map((_, index) => {
      const day = new Date(today)
      day.setDate(today.getDate() - (6 - index))
      const key = getDateKey(day.getTime())
      return {
        key,
        label: toDisplayDate(key),
        total: 0,
        correct: 0,
      }
    })

    const day_map = new Map(days.map((item) => [item.key, item]))
    for (const record of records) {
      const key = getDateKey(record.timestamp)
      const entry = day_map.get(key)
      if (!entry) {
        continue
      }
      entry.total += 1
      if (record.is_correct) {
        entry.correct += 1
      }
    }

    return days.map((item) => ({
      ...item,
      accuracy: item.total ? Math.round((item.correct / item.total) * 100) : 0,
    }))
  }, [records])

  const max_daily_total = Math.max(...daily_trend.map((item) => item.total), 1)
  const max_daily_accuracy = Math.max(...daily_trend.map((item) => item.accuracy), 1)

  const record_metrics_by_disease = useMemo(() => {
    const metric_map = new Map<string, { total: number; correct: number; covered: Set<string> }>()
    for (const item of records) {
      const current = metric_map.get(item.disease_id) ?? { total: 0, correct: 0, covered: new Set<string>() }
      current.total += 1
      if (item.is_correct) {
        current.correct += 1
      }
      current.covered.add(item.syndrome_id)
      metric_map.set(item.disease_id, current)
    }
    return metric_map
  }, [records])

  const disease_accuracy = useMemo(() => {
    return diseases.map((disease) => {
      const metric = record_metrics_by_disease.get(disease.disease_id)
      const total = metric?.total ?? 0
      const disease_correct = metric?.correct ?? 0
      const covered = metric?.covered.size ?? 0
      return {
        disease_id: disease.disease_id,
        disease_name: disease.disease_name,
        category: disease.category,
        syndrome_count: disease.syndromes.length,
        total,
        covered,
        progress: Math.round((covered / disease.syndromes.length) * 100),
        accuracy: total ? Math.round((disease_correct / total) * 100) : 0,
      }
    })
  }, [diseases, record_metrics_by_disease])

  const library_rows = useMemo(() => {
    const filtered = disease_accuracy
      .filter((item) => (category_filter === '全部' ? true : item.category === category_filter))
      .filter((item) => item.disease_name.includes(search_text.trim()))
    if (library_sort === 'accuracy_desc') {
      return [...filtered].sort((left, right) => right.accuracy - left.accuracy)
    }
    if (library_sort === 'accuracy_asc') {
      return [...filtered].sort((left, right) => left.accuracy - right.accuracy)
    }
    if (library_sort === 'progress_desc') {
      return [...filtered].sort((left, right) => right.progress - left.progress)
    }
    if (library_sort === 'progress_asc') {
      return [...filtered].sort((left, right) => left.progress - right.progress)
    }
    return filtered
  }, [category_filter, disease_accuracy, library_sort, search_text])

  const review_wrong_items = useMemo(() => {
    return wrong_records
      .map((item) => {
        const disease_name = disease_name_by_id.get(item.disease_id) ?? '未知病种'
        return { ...item, disease_name }
      })
  }, [disease_name_by_id, wrong_records])

  const review_filtered_items = useMemo(() => {
    return review_wrong_items
      .filter((item) => (review_type_filter === '全部' ? true : item.question_type === review_type_filter))
      .filter((item) => (review_disease_filter === '全部' ? true : item.disease_id === review_disease_filter))
      .slice(0, 50)
  }, [review_disease_filter, review_type_filter, review_wrong_items])

  const recent_practice_rows = useMemo(() => {
    const latest_records = [...records].sort((left, right) => right.timestamp - left.timestamp)
    const seen = new Set<string>()
    const result: Array<{
      disease_id: string
      disease_name: string
      last_time: number
      accuracy: number
      progress: number
      syndrome_count: number
    }> = []

    for (const record of latest_records) {
      if (seen.has(record.disease_id)) {
        continue
      }
      seen.add(record.disease_id)
      const match = disease_accuracy.find((item) => item.disease_id === record.disease_id)
      if (!match) {
        continue
      }
      result.push({
        disease_id: match.disease_id,
        disease_name: match.disease_name,
        last_time: record.timestamp,
        accuracy: match.accuracy,
        progress: match.progress,
        syndrome_count: match.syndrome_count,
      })
      if (result.length >= 5) {
        break
      }
    }
    return result
  }, [disease_accuracy, records])

  const weak_disease_top3 = useMemo(() => {
    return disease_accuracy
      .filter((item) => item.total > 0 && item.accuracy < 60)
      .sort((left, right) => left.accuracy - right.accuracy)
      .slice(0, 3)
  }, [disease_accuracy])

  const bookmark_question_id_set = useMemo(() => {
    return new Set(bookmarks.map((item) => item.question_id))
  }, [bookmarks])

  useEffect(() => {
    let cancelled = false

    async function initAppData() {
      try {
        setIsInitializing(true)
        setLoadingProgress(8)
        setLoadingText('正在连接本地存储')
        const storage_task = Promise.all([getAnswerRecords(), getBookmarks()])

        setLoadingProgress(35)
        setLoadingText('正在加载完整题库')
        const next_dataset = await loadDataset()
        if (cancelled) {
          return
        }

        setLoadingProgress(72)
        setLoadingText('正在同步学习记录')
        const [next_records, next_bookmarks] = await storage_task
        if (cancelled) {
          return
        }

        setDatasetBundle(next_dataset)
        setRecords(next_records)
        setBookmarks(next_bookmarks)
        setDatasetError(null)
        setLoadingProgress(100)
        setLoadingText('加载完成')
        setIsInitializing(false)
        trackEvent(EVENTS.APP_OPEN)
      } catch (error) {
        console.error('初始化应用数据失败', error)
        if (!cancelled) {
          setDatasetError('题库加载失败，请刷新后重试。')
          setIsInitializing(false)
          setLoadingProgress(0)
          setLoadingText('初始化失败')
        }
      }
    }

    void initAppData()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!dataset_bundle) {
      return undefined
    }
    if (prefetched_random_session && prefetched_q1_session) {
      return undefined
    }

    let cancelled = false
    let timeout_id: number | null = null
    let idle_id: number | null = null

    const run_prefetch = () => {
      if (cancelled) {
        return
      }
      setIsPrefetchingSessions(true)
      try {
        if (!prefetched_random_session) {
          setPrefetchedRandomSession(generateRandom(dataset_bundle, 50))
        }
        if (!prefetched_q1_session) {
          setPrefetchedQ1Session(generateRandom(dataset_bundle, 50, ['Q1']))
        }
      } finally {
        if (!cancelled) {
          setIsPrefetchingSessions(false)
        }
      }
    }

    if ('requestIdleCallback' in window) {
      idle_id = window.requestIdleCallback(run_prefetch, { timeout: 1200 })
    } else {
      timeout_id = setTimeout(run_prefetch, 150) as unknown as number
    }

    return () => {
      cancelled = true
      if (idle_id !== null) {
        window.cancelIdleCallback(idle_id)
      }
      if (timeout_id !== null) {
        clearTimeout(timeout_id)
      }
    }
  }, [dataset_bundle, prefetched_q1_session, prefetched_random_session])

  function startSession(
    next_questions: Question[],
    options: {
      mode?: SessionMode
      total_seconds?: number
    } = {},
  ) {
    const mode = options.mode ?? 'practice'
    const now = now_timestamp()
    setQuestions(next_questions)
    setCurrentIndex(0)
    setSelectedIndex(null)
    setSubmitted(false)
    setSessionMode(mode)
    setExamSummary(null)
    setPracticeSummary(null)
    setSessionAnswers({})
    setSessionStartedAt(now)
    setStartedAt(now)
    setRemainingSeconds(options.total_seconds ?? PRACTICE_QUESTION_SECONDS)
    setTab('practice')
    trackEvent(EVENTS.SESSION_START, { mode, count: next_questions.length })
  }

  async function retryDatasetLoad() {
    try {
      setDatasetError(null)
      setIsInitializing(true)
      setLoadingProgress(30)
      setLoadingText('正在重试加载题库')
      const next_dataset = await loadDataset()
      setDatasetBundle(next_dataset)
      setPrefetchedRandomSession(null)
      setPrefetchedQ1Session(null)
      setDatasetError(null)
      setLoadingProgress(100)
      setLoadingText('加载完成')
      setIsInitializing(false)
    } catch (error) {
      console.error('重试加载题库失败', error)
      setDatasetError('题库加载失败，请稍后再试。')
      setIsInitializing(false)
      setLoadingProgress(0)
      setLoadingText('重试失败')
    }
  }

  function startRandomSession(count: number, type_filter: QuestionType[] = []) {
    if (!dataset_bundle) {
      return
    }
    if (count === 50 && type_filter.length === 0 && prefetched_random_session && prefetched_random_session.length > 0) {
      startSession(prefetched_random_session)
      setPrefetchedRandomSession(null)
      return
    }
    if (
      count === 50 &&
      type_filter.length === 1 &&
      type_filter[0] === 'Q1' &&
      prefetched_q1_session &&
      prefetched_q1_session.length > 0
    ) {
      startSession(prefetched_q1_session)
      setPrefetchedQ1Session(null)
      return
    }
    startSession(generateRandom(dataset_bundle, count, type_filter))
  }

  function startCaseExamSession() {
    if (!dataset_bundle) {
      return
    }
    const cases = generateRandomCases(dataset_bundle, CASE_EXAM_QUESTION_COUNT)
    setCaseQuestions(cases)
    setCaseIndex(0)
    setCaseAnswerVisible(false)
    setCaseRatings({})
    setCaseExamSummary(null)
    setSessionMode('case_exam')
    setSessionStartedAt(now_timestamp())
    setRemainingSeconds(CASE_EXAM_TOTAL_SECONDS)
    setTab('practice')
    trackEvent(EVENTS.SESSION_START, { mode: 'case_exam', count: CASE_EXAM_QUESTION_COUNT })
  }

  function startCasePracticeByDisease(disease_id: string) {
    if (!dataset_bundle) {
      return
    }
    const cases = generateCasesByDisease(dataset_bundle, disease_id)
    setCaseQuestions(cases)
    setCaseIndex(0)
    setCaseAnswerVisible(false)
    setCaseRatings({})
    setCaseExamSummary(null)
    setSessionMode('case_practice')
    setRemainingSeconds(0)
    setTab('practice')
    trackEvent(EVENTS.SESSION_START, { mode: 'case_practice', count: cases.length })
  }

  function startDiseaseSession(disease_id: string, count: number) {
    if (!dataset_bundle) {
      return
    }
    startSession(generateByDisease(dataset_bundle, disease_id, count))
  }

  const buildExamSummary = useCallback((
    answers: Record<string, SessionAnswerSummary>,
    reason: ExamFinishReason,
    used_seconds_override?: number,
  ): ExamSummary => {
    const answer_list = questions
      .map((question) => answers[question.id])
      .filter((item): item is SessionAnswerSummary => Boolean(item))
    const answered = answer_list.length
    const correct = answer_list.filter((item) => item.is_correct).length
    const total = questions.length
    const accuracy = total ? Math.round((correct / total) * 100) : 0
    return {
      reason,
      total,
      answered,
      correct,
      accuracy,
      used_seconds:
        used_seconds_override ??
        Math.max(0, Math.round((now_timestamp() - session_started_at) / 1000)),
      finished_at: now_timestamp(),
      answers: answer_list,
    }
  }, [questions, session_started_at])

  const persistQuestionResult = useCallback(async (
    question: Question,
    answer_index: number | null,
    submit_time: number,
    auto_submitted: boolean,
  ): Promise<SessionAnswerSummary | null> => {
    const user_answer = answer_index === null ? '' : (question.options[answer_index]?.text ?? '')
    const is_correct = answer_index === question.correct_index
    try {
      await saveAnswerRecord({
        id: create_record_id(),
        question_id: question.id,
        syndrome_id: question.syndrome_id,
        disease_id: question.disease_id,
        question_type: question.question_type,
        user_answer,
        is_correct,
        timestamp: submit_time,
        duration_ms: submit_time - started_at,
      })
      setRecords(await getAnswerRecords())
      return {
        question_id: question.id,
        question_type: question.question_type,
        disease_id: question.disease_id,
        syndrome_id: question.syndrome_id,
        user_answer,
        correct_answer: question.explanation.correct_answer,
        is_correct,
        auto_submitted,
      }
    } catch (error) {
      console.error('保存答题记录失败', error)
      setSubmitted(false)
      return null
    }
  }, [started_at])

  const finishExam = useCallback((
    answers: Record<string, SessionAnswerSummary>,
    reason: ExamFinishReason,
    used_seconds_override?: number,
  ) => {
    const summary = buildExamSummary(answers, reason, used_seconds_override)
    setExamSummary(summary)
    setSubmitted(true)
    trackEvent(EVENTS.SESSION_COMPLETE, { mode: 'exam', accuracy: summary.accuracy, total: summary.total })
  }, [buildExamSummary])

  async function submitAnswer(answer_index: number | null = selected_index) {
    if (!current_question || submitted) {
      return
    }
    setSubmitted(true)
    const submitted_at = now_timestamp()
    const summary = await persistQuestionResult(current_question, answer_index, submitted_at, false)
    if (!summary) {
      return
    }
    setSessionAnswers((current) => ({
      ...current,
      [current_question.id]: summary,
    }))
  }

  function nextQuestion() {
    if (current_index + 1 >= questions.length) {
      if (session_mode === 'exam') {
        finishExam(session_answers, 'completed')
      } else {
        // 练习模式完成 → 显示总结页
        const answer_list = Object.values(session_answers)
        const correct = answer_list.filter((a) => a.is_correct).length
        const total = questions.length
        const used = Math.max(0, Math.round((now_timestamp() - session_started_at) / 1000))
        const summary: PracticeSummary = {
          total,
          correct,
          accuracy: total ? Math.round((correct / total) * 100) : 0,
          used_seconds: used,
        }
        setPracticeSummary(summary)
        trackEvent(EVENTS.SESSION_COMPLETE, { mode: 'practice', accuracy: summary.accuracy, total })
      }
      return
    }
    setCurrentIndex((value) => value + 1)
    setSelectedIndex(null)
    setSubmitted(false)
    setStartedAt(now_timestamp())
    if (session_mode === 'practice') {
      setRemainingSeconds(PRACTICE_QUESTION_SECONDS)
    }
  }

  async function submitExamPaper() {
    if (session_mode !== 'exam' || exam_summary) {
      return
    }
    let next_answers = session_answers
    if (current_question && !submitted) {
      setSubmitted(true)
      const submit_time = now_timestamp()
      const summary = await persistQuestionResult(current_question, selected_index, submit_time, false)
      if (!summary) {
        return
      }
      next_answers = {
        ...session_answers,
        [current_question.id]: summary,
      }
      setSessionAnswers(next_answers)
    }
    finishExam(next_answers, 'manual_submit')
  }

  function closeExamSummary() {
    setSessionMode('practice')
    setExamSummary(null)
    setQuestions([])
    setCurrentIndex(0)
    setSelectedIndex(null)
    setSubmitted(false)
    setSessionAnswers({})
    setRemainingSeconds(PRACTICE_QUESTION_SECONDS)
    setTab('dashboard')
  }

  function closePracticeSummary() {
    setPracticeSummary(null)
    setQuestions([])
    setCurrentIndex(0)
    setSelectedIndex(null)
    setSubmitted(false)
    setSessionAnswers({})
    setRemainingSeconds(PRACTICE_QUESTION_SECONDS)
    setTab('dashboard')
  }

  /* ── 病案题导航 ── */

  function revealCaseAnswer() {
    setCaseAnswerVisible(true)
  }

  function rateCaseAnswer(rating: CaseSelfRating) {
    if (!current_case) return
    setCaseRatings((prev) => ({ ...prev, [current_case.id]: rating }))
  }

  function nextCaseQuestion() {
    if (case_index + 1 >= case_questions.length) {
      finishCaseExam('completed')
      return
    }
    setCaseIndex((i) => i + 1)
    setCaseAnswerVisible(false)
  }

  function finishCaseExam(reason: 'completed' | 'manual_submit' | 'time_up') {
    const used_seconds = Math.max(0, Math.round((now_timestamp() - session_started_at) / 1000))
    const rating_values = Object.values(case_ratings)
    const mastered = rating_values.filter((r) => r === 'mastered').length
    const partial = rating_values.filter((r) => r === 'partial').length
    const failed = rating_values.filter((r) => r === 'failed').length
    setCaseExamSummary({
      reason,
      total: case_questions.length,
      reviewed: rating_values.length,
      mastered,
      partial,
      failed,
      used_seconds,
      finished_at: now_timestamp(),
      cases: case_questions,
      ratings: case_ratings,
    })
  }

  function submitCaseExamPaper() {
    if (session_mode !== 'case_exam' || case_exam_summary) return
    // 如果当前题未评分，先标记为未作答
    if (current_case && !case_ratings[current_case.id]) {
      setCaseRatings((prev) => ({ ...prev, [current_case.id]: 'failed' }))
    }
    finishCaseExam('manual_submit')
  }

  function closeCaseExamSummary() {
    setSessionMode('practice')
    setCaseExamSummary(null)
    setCaseQuestions([])
    setCaseIndex(0)
    setCaseAnswerVisible(false)
    setCaseRatings({})
    setRemainingSeconds(PRACTICE_QUESTION_SECONDS)
    setTab('dashboard')
  }

  function navigateTab(next_tab: Tab) {
    if (is_exam_running && next_tab !== 'practice') {
      return
    }
    setTab(next_tab)
    trackEvent(EVENTS.TAB_SWITCH, { tab: next_tab })
  }

  useEffect(() => {
    // 选择题练习/考试计时
    if (tab !== 'practice' || is_case_mode) {
      // 不在此 effect 处理病案模式
    } else if (current_question && !submitted && !exam_summary) {
      const timer = window.setInterval(() => {
        setRemainingSeconds((current) => {
          if (current <= 1) {
            window.clearInterval(timer)
            setSubmitted(true)
            void (async () => {
              const timeout_at = now_timestamp()
              const summary = await persistQuestionResult(current_question, null, timeout_at, true)
              if (!summary) {
                setSubmitted(false)
                return
              }

              setSessionAnswers((current_answers) => {
                const next_answers = {
                  ...current_answers,
                  [current_question.id]: summary,
                }
                if (session_mode === 'exam') {
                  finishExam(next_answers, 'time_up', remaining_seconds)
                }
                return next_answers
              })
            })()
            return 0
          }
          return current - 1
        })
      }, 1000)
      return () => window.clearInterval(timer)
    }
    return undefined
  }, [current_question, exam_summary, finishExam, is_case_mode, persistQuestionResult, remaining_seconds, session_mode, submitted, tab])

  // 病案考试模式计时
  useEffect(() => {
    if (tab !== 'practice' || session_mode !== 'case_exam' || case_exam_summary) {
      return undefined
    }
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          finishCaseExam('time_up')
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, session_mode, case_exam_summary])

  async function handleToggleBookmark() {
    if (!current_question) {
      return
    }
    await toggleBookmark({
      id: create_record_id(),
      question_id: current_question.id,
      syndrome_id: current_question.syndrome_id,
      question_type: current_question.question_type,
      question_snapshot: current_question,
      created_at: now_timestamp(),
    })
    setBookmarks(await getBookmarks())
    trackEvent(EVENTS.BOOKMARK_TOGGLE, { question_type: current_question.question_type })
  }

  function categoryClass(category: string): string {
    if (category === '内科') {
      return 'cat cat_in'
    }
    if (category === '外科') {
      return 'cat cat_out'
    }
    if (category === '妇科') {
      return 'cat cat_woman'
    }
    if (category === '儿科') {
      return 'cat cat_child'
    }
    return 'cat cat_other'
  }

  function retrainWrongItem(item: { syndrome_id: string; question_type: QuestionType }) {
    if (!dataset_bundle) {
      return
    }
    const all_types: QuestionType[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']
    const candidates = all_types.filter((type) => type !== item.question_type)
    const picked_type = pickOne(candidates)
    const question = generateQuestion(dataset_bundle, item.syndrome_id, picked_type)
    startSession([question])
  }

  function startWrongReviewSession() {
    if (!dataset_bundle || wrong_records.length === 0) {
      return
    }
    // 按 syndrome_id + question_type 去重
    const seen = new Set<string>()
    const unique: { syndrome_id: string; question_type: QuestionType }[] = []
    for (const item of wrong_records) {
      const key = `${item.syndrome_id}__${item.question_type}`
      if (!seen.has(key)) {
        seen.add(key)
        unique.push({ syndrome_id: item.syndrome_id, question_type: item.question_type })
      }
    }
    // 随机打乱后取最多 20 题
    const picked = shuffle(unique).slice(0, 20)
    const questions = picked.map((item) =>
      generateQuestion(dataset_bundle, item.syndrome_id, item.question_type),
    )
    startSession(questions)
  }

  function startBookmarkReviewSession() {
    if (bookmarks.length === 0) {
      return
    }
    const snapshots = bookmarks.map((item) => item.question_snapshot)
    startSession(shuffle(snapshots))
  }

  function diseaseStatus(item: { progress: number; accuracy: number; total: number }): {
    text: string
    class_name: string
  } {
    if (item.progress >= 100 && item.accuracy >= 85 && item.total > 0) {
      return { text: '已掌握', class_name: 'status_tag status_mastered' }
    }
    if (item.total > 0 && item.accuracy < 60) {
      return { text: '需加强', class_name: 'status_tag status_weak' }
    }
    if (item.total === 0) {
      return { text: '未开始', class_name: 'status_tag status_new' }
    }
    return { text: '进行中', class_name: 'status_tag status_active' }
  }

  const timer_text = formatDuration(remaining_seconds)

  return (
    <div className="app">
      <header className="top_bar">
        <div className="header_title_row">
          <div className="header_placeholder" />
          <div className="header_title_center">
            <h1 className="title_main">中医执医实践技能<span className="title_accent">（第一站）</span>复习</h1>
            <p className="title_sub">病案分析 · 辨证论治专项训练</p>
          </div>
          <button className="icon_btn" onClick={() => navigateTab('stats')} disabled={is_exam_running}>
            统计
          </button>
        </div>
      </header>

      {!dataset_bundle && (
        <section className="panel">
          <article className="card">
            <h2 className="card_title">题库加载中</h2>
            <p className="hint_text">{loading_text}（{loading_progress}%）</p>
            <div className="progress_track">
              <div className="progress_fill" style={{ width: `${loading_progress}%` }} />
            </div>
          </article>
        </section>
      )}

      {dataset_error && (
        <section className="panel">
          <article className="card">
            <h2 className="card_title">题库加载异常</h2>
            <p className="hint_text">{dataset_error}</p>
            <div className="action_row">
              <button className="primary_btn" onClick={() => void retryDatasetLoad()}>
                重新加载题库
              </button>
            </div>
          </article>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="panel">
          <article className="hero_card">
            <div>
              <p className="hero_subtitle">
                {streak_days > 0 ? `连续学习 ${streak_days} 天` : '今日概览'}
              </p>
              <h2 className="hero_title">
                {today_stats.count > 0
                  ? `今日已练 ${today_stats.count} 题`
                  : '今天还没开始练习'}
              </h2>
              <p className="hero_desc">覆盖 {overview_stats.covered_syndromes} / {syndromes.length} 个证型</p>
              {is_prefetching_sessions && <p className="hero_subtitle">正在后台预热练习题</p>}
            </div>
            <button className="hero_button" onClick={() => startRandomSession(50)} disabled={!dataset_bundle || is_initializing}>
              随机刷题
            </button>
          </article>

          <div className="metric_grid">
            <article className="metric_card">
              <span className="metric_label">今日答题</span>
              <span className="metric_value">{today_stats.count}</span>
            </article>
            <article className="metric_card">
              <span className="metric_label">今日正确率</span>
              <span className="metric_value">{today_stats.count > 0 ? `${today_stats.accuracy}%` : '--'}</span>
            </article>
            <article className="metric_card">
              <span className="metric_label">总答题</span>
              <span className="metric_value">{records.length}</span>
            </article>
            <article className="metric_card">
              <span className="metric_label">总体正确率</span>
              <span className="metric_value">{overview_stats.accuracy}%</span>
            </article>
            <article className="metric_card">
              <span className="metric_label">证型覆盖</span>
              <span className="metric_value">{overview_stats.covered_syndromes}</span>
            </article>
            <article className="metric_card">
              <span className="metric_label">收藏题目</span>
              <span className="metric_value">{bookmarks.length}</span>
            </article>
          </div>

          <article className="card">
            <h2 className="card_title">快捷训练</h2>
            <div className="quick_actions">
              <button
                className="quick_btn quick_btn_random"
                onClick={() => startRandomSession(50)}
                disabled={!dataset_bundle || is_initializing}
              >
                随机刷题
              </button>
              <button className="quick_btn quick_btn_disease" onClick={() => navigateTab('library')} disabled={is_exam_running}>
                按病种练习
              </button>
              <button
                className="quick_btn quick_btn_focus"
                onClick={() => startRandomSession(50, ['Q1'])}
                disabled={!dataset_bundle || is_initializing}
              >
                Q1 专项突破
              </button>
              <button
                className="quick_btn quick_btn_exam"
                onClick={startCaseExamSession}
                disabled={!dataset_bundle || is_initializing}
              >
                模拟考试（病案论述 · 2题 / 60分钟）
              </button>
              <button
                className="quick_btn quick_btn_exam"
                onClick={startWrongReviewSession}
                disabled={!dataset_bundle || is_initializing || wrong_records.length === 0}
              >
                错题重练（{wrong_records.length}题）
              </button>
              <button
                className="quick_btn quick_btn_bookmark"
                onClick={startBookmarkReviewSession}
                disabled={bookmarks.length === 0}
              >
                收藏题练习（{bookmarks.length}题）
              </button>
            </div>
          </article>

          <article className="card">
            <h2 className="card_title">最近练习病种</h2>
            {recent_practice_rows.length === 0 ? (
              <p className="hint_text">暂无最近练习记录。</p>
            ) : (
              <div className="recent_row">
                {recent_practice_rows.map((item) => (
                  <button
                    key={item.disease_id}
                    className="recent_card"
                    onClick={() => startDiseaseSession(item.disease_id, item.syndrome_count)}
                  >
                    <span className="recent_name">{item.disease_name}</span>
                    <span className="recent_meta">覆盖 {item.progress}% · 正确率 {item.accuracy}%</span>
                    <span className="recent_time">{new Date(item.last_time).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}
          </article>

          <article className="card">
            <h2 className="card_title">薄弱题型提醒</h2>
            <div className="weak_list">
              {weak_types.length ? (
                weak_types.map((item) => (
                  <div key={item.question_type} className="weak_item">
                    <span>{item.question_type}</span>
                    <span>{item.accuracy}%</span>
                  </div>
                ))
              ) : (
                <p className="hint_text">暂无低于 60% 的题型，继续保持。</p>
              )}
            </div>
          </article>

          {records.length > 0 && (
            <button
              className="quick_btn quick_btn_random full_btn"
              onClick={() => setShareCardData({
                type: 'progress',
                total_answered: records.length,
                accuracy: overview_stats.accuracy,
                streak_days,
                covered_syndromes: overview_stats.covered_syndromes,
                total_syndromes: syndromes.length,
                today_count: today_stats.count,
              })}
            >
              分享我的学习进度
            </button>
          )}
        </section>
      )}

      {tab === 'library' && (
        <section className="panel">
          <article className="card">
            <h2 className="card_title">病种库</h2>
            <input
              className="search_input"
              placeholder="搜索病种"
              value={search_text}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <div className="chip_row">
              {(['全部', '内科', '外科', '妇科', '儿科', '其他'] as const).map((item) => (
                <button
                  key={item}
                  className={category_filter === item ? 'chip chip_active' : 'chip'}
                  onClick={() => setCategoryFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="sort_row">
              <span>排序</span>
              <select
                className="sort_select"
                value={library_sort}
                onChange={(event) => setLibrarySort(event.target.value as typeof library_sort)}
              >
                <option value="default">默认</option>
                <option value="accuracy_desc">正确率从高到低</option>
                <option value="accuracy_asc">正确率从低到高</option>
                <option value="progress_desc">覆盖度从高到低</option>
                <option value="progress_asc">覆盖度从低到高</option>
              </select>
            </div>
          </article>

          {library_rows.map((item) => (
            <article key={item.disease_id} className="disease_card">
              <div className="disease_header">
                <div>
                  <h3>{item.disease_name}</h3>
                  <div className="disease_meta">
                    <span className={categoryClass(item.category)}>{item.category}</span>
                    <span>{item.syndrome_count} 证型</span>
                  </div>
                </div>
                <span className={diseaseStatus(item).class_name}>{diseaseStatus(item).text}</span>
                <button
                  className="start_btn"
                  onClick={() => startDiseaseSession(item.disease_id, item.syndrome_count)}
                  disabled={!dataset_bundle || is_initializing}
                >
                  选择题
                </button>
                <button
                  className="start_btn start_btn_case"
                  onClick={() => startCasePracticeByDisease(item.disease_id)}
                  disabled={!dataset_bundle || is_initializing}
                >
                  病案题
                </button>
              </div>
              <div className="progress_row">
                <span>覆盖度 {item.progress}%</span>
                <span>正确率 {item.accuracy}%</span>
              </div>
              <div className="progress_track">
                <div
                  className={item.total > 0 && item.accuracy < 60 ? 'progress_fill progress_fill_weak' : 'progress_fill'}
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === 'practice' && (
        <section className="panel">
          {/* ═══ 病案论述题：考试总结 ═══ */}
          {is_case_mode && case_exam_summary ? (
            <article className="card exam_summary_card">
              <h2 className="card_title">
                {session_mode === 'case_exam' ? '病案考试已结束' : '病案练习已完成'}
              </h2>
              <div className="exam_summary_grid">
                <div className="metric_card">
                  <span className="metric_label">总题数</span>
                  <span className="metric_value">{case_exam_summary.total}</span>
                </div>
                <div className="metric_card">
                  <span className="metric_label">已评估</span>
                  <span className="metric_value">{case_exam_summary.reviewed}</span>
                </div>
                <div className="metric_card metric_card_green">
                  <span className="metric_label">掌握</span>
                  <span className="metric_value">{case_exam_summary.mastered}</span>
                </div>
                <div className="metric_card metric_card_yellow">
                  <span className="metric_label">部分掌握</span>
                  <span className="metric_value">{case_exam_summary.partial}</span>
                </div>
                <div className="metric_card metric_card_red">
                  <span className="metric_label">未掌握</span>
                  <span className="metric_value">{case_exam_summary.failed}</span>
                </div>
                {session_mode === 'case_exam' && (
                  <div className="metric_card">
                    <span className="metric_label">用时</span>
                    <span className="metric_value">{formatDuration(case_exam_summary.used_seconds)}</span>
                  </div>
                )}
              </div>
              {session_mode === 'case_exam' && (
                <p className="hint_text">
                  交卷方式：
                  {case_exam_summary.reason === 'completed'
                    ? '完成全部题目'
                    : case_exam_summary.reason === 'manual_submit'
                      ? '手动交卷'
                      : '考试超时自动交卷'}
                </p>
              )}

              {/* 考试结束后逐题回顾（含标准答案） */}
              <div className="case_review_list">
                {case_exam_summary.cases.map((c, idx) => {
                  const rating = case_exam_summary.ratings[c.id]
                  return (
                    <div key={c.id} className="case_review_item">
                      <h3 className="case_review_title">第 {idx + 1} 题</h3>
                      <p className="case_text_block">{c.case_text}</p>
                      <div className="case_answer_card">
                        <div className="case_answer_row">
                          <span className="case_answer_label">诊断</span>
                          <span>{c.standard_answer.diagnosis_text}</span>
                        </div>
                        <div className="case_answer_row">
                          <span className="case_answer_label">证机概要</span>
                          <span>{c.standard_answer.pathogenesis}</span>
                        </div>
                        <div className="case_answer_row">
                          <span className="case_answer_label">治法</span>
                          <span>{c.standard_answer.treatment_method}</span>
                        </div>
                        <div className="case_answer_row">
                          <span className="case_answer_label">处方</span>
                          <span>{c.standard_answer.prescription}</span>
                        </div>
                        <div className="case_answer_row">
                          <span className="case_answer_label">辨证要点</span>
                          <ul className="case_key_list">
                            {c.standard_answer.key_symptom_analysis.map((k) => (
                              <li key={k}>{k}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="case_answer_row">
                          <span className="case_answer_label">完整证候</span>
                          <span>{c.standard_answer.full_symptoms}</span>
                        </div>
                      </div>
                      {rating && (
                        <span className={`case_rating_tag case_rating_${rating}`}>
                          {rating === 'mastered' ? '掌握' : rating === 'partial' ? '部分掌握' : '未掌握'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="action_row">
                <button
                  className="primary_btn"
                  onClick={() => setShareCardData({
                    type: 'case',
                    mastered: case_exam_summary.mastered,
                    partial: case_exam_summary.partial,
                    failed: case_exam_summary.failed,
                    total: case_exam_summary.total,
                    used_seconds: case_exam_summary.used_seconds,
                    mode: session_mode as 'case_exam' | 'case_practice',
                  })}
                >
                  分享成绩
                </button>
                <button className="secondary_btn" onClick={closeCaseExamSummary}>返回首页</button>
              </div>
            </article>

          /* ═══ 病案论述题：答题中 ═══ */
          ) : is_case_mode && current_case ? (
            <>
              <div className="practice_head">
                <div className="progress">
                  <span>
                    {session_mode === 'case_exam' ? `病案考试 ${case_progress}` : `病案练习 ${case_progress}`}
                  </span>
                  <div className="practice_right_meta">
                    <span className="badge">论述题</span>
                    {session_mode === 'case_exam' && (
                      <span
                        className={remaining_seconds <= 300 ? 'timer_badge timer_badge_warning' : 'timer_badge'}
                      >
                        {timer_text}
                      </span>
                    )}
                  </div>
                </div>
                <div className="progress_track">
                  <div
                    className="progress_fill"
                    style={{ width: `${((case_index + 1) / Math.max(case_questions.length, 1)) * 100}%` }}
                  />
                </div>
              </div>

              {/* 病案正文 */}
              <article className="card case_card">
                <h3 className="case_card_title">病案</h3>
                <p className="case_text_block">{current_case.case_text}</p>

                <div className="case_prompt_block">
                  <h4 className="case_prompt_title">请根据以上病案，回答以下问题：</h4>
                  {CASE_EXAM_PROMPTS.map((prompt) => (
                    <p key={prompt} className="case_prompt_item">{prompt}</p>
                  ))}
                </div>

                {/* 操作按钮 */}
                {!case_answer_visible ? (
                  <div className="action_row">
                    <button className="primary_btn" onClick={revealCaseAnswer}>
                      我已作答，查看标准答案
                    </button>
                    {session_mode === 'case_exam' && (
                      <>
                        <button className="secondary_btn" onClick={nextCaseQuestion}>
                          {case_index + 1 >= case_questions.length ? '完成' : '跳过，下一题'}
                        </button>
                        <button className="secondary_btn" onClick={submitCaseExamPaper}>交卷</button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* 标准答案展示 */}
                    <div className="case_answer_card">
                      <h4 className="case_answer_heading">标准答案</h4>
                      <div className="case_answer_row">
                        <span className="case_answer_label">中医诊断</span>
                        <span className="case_answer_value">{current_case.standard_answer.diagnosis_text}</span>
                      </div>
                      <div className="case_answer_row">
                        <span className="case_answer_label">证机概要</span>
                        <span className="case_answer_value">{current_case.standard_answer.pathogenesis}</span>
                      </div>
                      <div className="case_answer_row">
                        <span className="case_answer_label">治法</span>
                        <span className="case_answer_value">{current_case.standard_answer.treatment_method}</span>
                      </div>
                      <div className="case_answer_row">
                        <span className="case_answer_label">处方</span>
                        <span className="case_answer_value">{current_case.standard_answer.prescription}</span>
                      </div>
                      <div className="case_answer_section">
                        <span className="case_answer_label">辨证要点</span>
                        <ul className="case_key_list">
                          {current_case.standard_answer.key_symptom_analysis.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="case_answer_section">
                        <span className="case_answer_label">完整证候</span>
                        <p className="case_full_symptoms">{current_case.standard_answer.full_symptoms}</p>
                      </div>
                    </div>

                    {/* 自我评估 */}
                    <div className="case_rating_row">
                      <span className="case_rating_label">自我评估：</span>
                      <button
                        className={`case_rating_btn case_rating_btn_mastered ${case_ratings[current_case.id] === 'mastered' ? 'active' : ''}`}
                        onClick={() => rateCaseAnswer('mastered')}
                      >
                        掌握
                      </button>
                      <button
                        className={`case_rating_btn case_rating_btn_partial ${case_ratings[current_case.id] === 'partial' ? 'active' : ''}`}
                        onClick={() => rateCaseAnswer('partial')}
                      >
                        部分掌握
                      </button>
                      <button
                        className={`case_rating_btn case_rating_btn_failed ${case_ratings[current_case.id] === 'failed' ? 'active' : ''}`}
                        onClick={() => rateCaseAnswer('failed')}
                      >
                        未掌握
                      </button>
                    </div>

                    <button className="primary_btn full_btn" onClick={nextCaseQuestion}>
                      {case_index + 1 >= case_questions.length
                        ? (session_mode === 'case_exam' ? '完成考试' : '完成本轮练习')
                        : '下一题'}
                    </button>
                  </>
                )}
              </article>
            </>

          /* ═══ MCQ 选择题模式（保持不变） ═══ */
          ) : exam_summary ? (
            <article className="card exam_summary_card">
              <h2 className="card_title">考试已结束</h2>
              <div className="exam_summary_grid">
                <div className="metric_card">
                  <span className="metric_label">完成题数</span>
                  <span className="metric_value">{exam_summary.answered} / {exam_summary.total}</span>
                </div>
                <div className="metric_card">
                  <span className="metric_label">答对题数</span>
                  <span className="metric_value">{exam_summary.correct}</span>
                </div>
                <div className="metric_card">
                  <span className="metric_label">正确率</span>
                  <span className="metric_value">{exam_summary.accuracy}%</span>
                </div>
                <div className="metric_card">
                  <span className="metric_label">用时</span>
                  <span className="metric_value">{formatDuration(exam_summary.used_seconds)}</span>
                </div>
              </div>
              <p className="hint_text">
                交卷方式：
                {exam_summary.reason === 'completed'
                  ? '完成全部题目'
                  : exam_summary.reason === 'manual_submit'
                    ? '手动交卷'
                    : '考试超时自动交卷'}
              </p>
              <div className="exam_answer_list">
                {exam_summary.answers.map((item, index) => (
                  <div key={item.question_id} className="exam_answer_item">
                    <span className="exam_answer_title">第 {index + 1} 题 · {item.question_type}</span>
                    <span className={item.is_correct ? 'result_ok' : 'result_bad'}>
                      {item.is_correct ? '正确' : '错误'}
                    </span>
                    <p className="exam_answer_text">
                      你的答案：{item.user_answer || '未作答'}；正确答案：{item.correct_answer}
                    </p>
                  </div>
                ))}
              </div>
              <div className="action_row">
                <button
                  className="primary_btn"
                  onClick={() => setShareCardData({
                    type: 'mcq',
                    accuracy: exam_summary.accuracy,
                    correct: exam_summary.correct,
                    total: exam_summary.total,
                    used_seconds: exam_summary.used_seconds,
                    mode: 'exam',
                  })}
                >
                  分享成绩
                </button>
                <button className="secondary_btn" onClick={closeExamSummary}>返回首页</button>
                <button className="secondary_btn" onClick={() => navigateTab('stats')}>查看统计</button>
              </div>
            </article>
          ) : practice_summary ? (
            <article className="card exam_summary_card">
              <h2 className="card_title">练习已完成</h2>
              <div className="exam_summary_grid">
                <div className="metric_card">
                  <span className="metric_label">完成题数</span>
                  <span className="metric_value">{practice_summary.total}</span>
                </div>
                <div className="metric_card">
                  <span className="metric_label">答对题数</span>
                  <span className="metric_value">{practice_summary.correct}</span>
                </div>
                <div className={`metric_card ${practice_summary.accuracy >= 60 ? 'metric_card_green' : 'metric_card_red'}`}>
                  <span className="metric_label">正确率</span>
                  <span className="metric_value">{practice_summary.accuracy}%</span>
                </div>
                <div className="metric_card">
                  <span className="metric_label">用时</span>
                  <span className="metric_value">{formatDuration(practice_summary.used_seconds)}</span>
                </div>
              </div>

              {/* 每日练习里程碑提示 */}
              <div className="daily_share_hint">
                <p className="daily_share_text">
                  {streak_days >= 3
                    ? `已连续学习 ${streak_days} 天，分享给同学一起备考吧`
                    : today_stats.count >= 50
                      ? `今日已练 ${today_stats.count} 题，分享打卡记录吧`
                      : '把成绩分享给备考的同学，一起进步'}
                </p>
              </div>

              <div className="action_row">
                <button
                  className="primary_btn"
                  onClick={() => setShareCardData({
                    type: 'mcq',
                    accuracy: practice_summary.accuracy,
                    correct: practice_summary.correct,
                    total: practice_summary.total,
                    used_seconds: practice_summary.used_seconds,
                    mode: 'practice',
                  })}
                >
                  分享成绩
                </button>
                <button className="secondary_btn" onClick={closePracticeSummary}>返回首页</button>
                <button className="secondary_btn" onClick={() => { closePracticeSummary(); navigateTab('stats') }}>查看统计</button>
              </div>
            </article>
          ) : !current_question ? (
            <article className="card">
              <h2 className="card_title">尚未开始练习</h2>
              <p className="hint_text">请先从首页或病种库发起一轮练习。</p>
            </article>
          ) : (
            <>
              <div className="practice_head">
                <div className="progress">
                  <span>{session_mode === 'exam' ? `考试进度 ${progress}` : `进度 ${progress}`}</span>
                  <div className="practice_right_meta">
                    <span className="badge">{session_mode === 'exam' ? `考试 · ${current_question.question_type}` : current_question.question_type}</span>
                    <span
                      className={
                        remaining_seconds <= (session_mode === 'exam' ? 120 : 30) && !submitted
                          ? 'timer_badge timer_badge_warning'
                          : 'timer_badge'
                      }
                    >
                      {timer_text}
                    </span>
                  </div>
                </div>
                <div className="progress_track">
                  <div
                    className="progress_fill"
                    style={{ width: `${((current_index + 1) / Math.max(questions.length, 1)) * 100}%` }}
                  />
                </div>
              </div>
              <article className="card question">
                <p className="stem">{current_question.stem}</p>
                <div className="options">
                  {current_question.options.map((option, index) => {
                    const selected = selected_index === index
                    const is_correct = submitted && index === current_question.correct_index
                    const is_wrong = submitted && selected && index !== current_question.correct_index
                    return (
                      <button
                        key={option.key}
                        className={`option ${selected ? 'selected' : ''} ${is_correct ? 'correct' : ''} ${is_wrong ? 'wrong' : ''}`}
                    onClick={() => !submitted && setSelectedIndex(index)}
                      >
                        <span className="option_key">{option.key}</span>
                        <span>{option.text}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="action_row">
                  <button
                    className="primary_btn"
                    disabled={selected_index === null || submitted}
                    onClick={() => void submitAnswer()}
                  >
                    确认提交
                  </button>
                  <button className="secondary_btn" onClick={() => void handleToggleBookmark()}>
                    {bookmark_question_id_set.has(current_question.id) ? '取消收藏' : '收藏本题'}
                  </button>
                  {session_mode === 'exam' && (
                    <button className="secondary_btn" onClick={() => void submitExamPaper()} disabled={Boolean(exam_summary)}>
                      交卷
                    </button>
                  )}
                </div>
              </article>

              {submitted && session_mode === 'practice' && (
                <article className="card analysis">
                  <h3 className={selected_index === current_question.correct_index ? 'result_ok' : 'result_bad'}>
                    {selected_index === current_question.correct_index ? '作答正确' : '作答错误'}
                  </h3>
                  <div className="analysis_block">
                    <p className="analysis_title">正确答案</p>
                    <p>
                      {current_question.options[current_question.correct_index].key}. {current_question.explanation.correct_answer}
                    </p>
                  </div>
                  <div className="analysis_block">
                    <p className="analysis_title">辨证要点</p>
                    <ul>
                      {current_question.explanation.key_symptom_analysis.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="analysis_block">
                    <p className="analysis_title">证机概要</p>
                    <p>{current_question.explanation.pathogenesis}</p>
                  </div>
                  <div className="analysis_grid">
                    <div className="analysis_block">
                      <p className="analysis_title">治法</p>
                      <p>{current_question.explanation.treatment_method}</p>
                    </div>
                    <div className="analysis_block">
                      <p className="analysis_title">方药</p>
                      <p>{current_question.explanation.prescription}</p>
                    </div>
                  </div>
                  <div className="analysis_block">
                    <p className="analysis_title">完整证候</p>
                    <p>{current_question.explanation.full_symptoms}</p>
                  </div>
                  <button className="primary_btn full_btn" onClick={nextQuestion}>
                    {current_index + 1 >= questions.length ? '完成本轮练习' : '下一题'}
                  </button>
                </article>
              )}
              {submitted && session_mode === 'exam' && (
                <article className="card">
                  <h3 className="card_title">本题已提交</h3>
                  <p className="hint_text">考试模式下不显示即时解析，请继续作答或交卷。</p>
                  <div className="action_row">
                    <button className="primary_btn" onClick={nextQuestion}>
                      {current_index + 1 >= questions.length ? '提交试卷' : '下一题'}
                    </button>
                    <button className="secondary_btn" onClick={() => void submitExamPaper()}>
                      立即交卷
                    </button>
                  </div>
                </article>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'review' && (
        <section className="panel">
          <article className="card">
            <h2 className="card_title">错题记录（{wrong_records.length}）</h2>
            <div className="review_filter_row">
              <select
                className="sort_select"
                value={review_type_filter}
                onChange={(event) => setReviewTypeFilter(event.target.value as typeof review_type_filter)}
              >
                <option value="全部">全部题型</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
                <option value="Q5">Q5</option>
                <option value="Q6">Q6</option>
              </select>
              <select
                className="sort_select"
                value={review_disease_filter}
                onChange={(event) => setReviewDiseaseFilter(event.target.value)}
              >
                <option value="全部">全部病种</option>
                {diseases.map((disease) => (
                  <option key={disease.disease_id} value={disease.disease_id}>
                    {disease.disease_name}
                  </option>
                ))}
              </select>
            </div>
            {review_filtered_items.length === 0 ? (
              <p className="hint_text">暂无错题。</p>
            ) : (
              review_filtered_items.map((item) => (
                <div key={item.id} className="review_item_card">
                  <div className="review_item_head">
                    <span>{item.disease_name}</span>
                    <span className="review_type_chip">{item.question_type}</span>
                  </div>
                  <p className="review_item_text">{item.user_answer || '超时未作答'}</p>
                  <div className="review_item_footer">
                    <p className="review_item_time">{new Date(item.timestamp).toLocaleString()}</p>
                    <button className="review_retry_btn" onClick={() => retrainWrongItem(item)}>
                      换题型重练
                    </button>
                  </div>
                </div>
              ))
            )}
          </article>
          <article className="card">
            <h2 className="card_title">收藏夹（{bookmarks.length}）</h2>
            {bookmarks.length === 0 ? (
              <p className="hint_text">暂无收藏题。</p>
            ) : (
              <div className="button_group">
                {bookmarks.map((item) => (
                  <button
                    key={item.id}
                    className="bookmark_btn"
                    onClick={() => {
                      startSession([item.question_snapshot])
                    }}
                  >
                    <span>{item.question_snapshot.question_type}</span>
                    <span>{item.question_snapshot.explanation.correct_answer}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        </section>
      )}

      {tab === 'stats' && (
        <section className="panel">
          <article className="card">
            <h2 className="card_title">近7天趋势</h2>
            <div className="trend_mode_tabs">
              <button
                className={trend_mode === 'count' ? 'trend_mode_btn active' : 'trend_mode_btn'}
                onClick={() => setTrendMode('count')}
              >
                答题量
              </button>
              <button
                className={trend_mode === 'accuracy' ? 'trend_mode_btn active' : 'trend_mode_btn'}
                onClick={() => setTrendMode('accuracy')}
              >
                正确率
              </button>
            </div>
            <div className="trend_grid">
              {daily_trend.map((item) => (
                <div key={item.key} className="trend_item">
                  <div className="trend_bar_wrap">
                    <div
                      className={trend_mode === 'count' ? 'trend_bar' : 'trend_bar trend_bar_accuracy'}
                      style={{
                        height: `${Math.max(
                          trend_mode === 'count'
                            ? (item.total / max_daily_total) * 100
                            : (item.accuracy / max_daily_accuracy) * 100,
                          6,
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="trend_count">{trend_mode === 'count' ? item.total : `${item.accuracy}%`}</span>
                  <span className="trend_day">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="trend_accuracy_row">
              {daily_trend.map((item) => (
                <span key={`${item.key}_acc`}>
                  {trend_mode === 'count' ? `${item.accuracy}%` : `${item.total}题`}
                </span>
              ))}
            </div>
          </article>

          <article className="card">
            <h2 className="card_title">按病种正确率</h2>
            {disease_accuracy.map((item) => (
              <div key={item.disease_id} className="record_item">
                <span>{item.disease_name}</span>
                <span>{item.accuracy}%</span>
                <span>{item.total}题</span>
              </div>
            ))}
          </article>
          <article className="card">
            <h2 className="card_title">按题型正确率</h2>
            {type_stats.map((item) => (
              <div key={item.question_type} className="record_item">
                <span>{item.question_type}</span>
                <span>{item.accuracy}%</span>
                <span>{item.total}题</span>
              </div>
            ))}
          </article>

          <article className="card">
            <h2 className="card_title">薄弱病种 Top3</h2>
            {weak_disease_top3.length === 0 ? (
              <p className="hint_text">暂无低于 60% 的病种。</p>
            ) : (
              weak_disease_top3.map((item, index) => (
                <div key={item.disease_id} className="top3_item">
                  <span className="top3_rank">{index + 1}</span>
                  <span className="top3_name">{item.disease_name}</span>
                  <span className="top3_score">{item.accuracy}%</span>
                  <button
                    className="top3_action"
                    onClick={() => startDiseaseSession(item.disease_id, item.syndrome_count)}
                    disabled={!dataset_bundle || is_initializing}
                  >
                    去练习
                  </button>
                </div>
              ))
            )}
          </article>
        </section>
      )}

      <nav className="bottom_nav">
        <button
          className={tab === 'dashboard' ? 'nav_btn active' : 'nav_btn'}
          onClick={() => navigateTab('dashboard')}
          disabled={is_exam_running}
        >
          首页
        </button>
        <button
          className={tab === 'library' ? 'nav_btn active' : 'nav_btn'}
          onClick={() => navigateTab('library')}
          disabled={is_exam_running}
        >
          病种库
        </button>
        <button className={tab === 'practice' ? 'nav_btn active' : 'nav_btn'} onClick={() => navigateTab('practice')}>
          答题
        </button>
        <button
          className={tab === 'review' ? 'nav_btn active' : 'nav_btn'}
          onClick={() => navigateTab('review')}
          disabled={is_exam_running}
        >
          复盘
        </button>
        <button
          className={tab === 'stats' ? 'nav_btn active' : 'nav_btn'}
          onClick={() => navigateTab('stats')}
          disabled={is_exam_running}
        >
          统计
        </button>
      </nav>

      {share_card_data && (
        <ShareCard
          data={share_card_data}
          app_url={window.location.origin}
          visible={share_card_data !== null}
          onClose={() => setShareCardData(null)}
        />
      )}
    </div>
  )
}

export default App
