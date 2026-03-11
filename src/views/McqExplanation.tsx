import type { Question } from '../types'

interface McqExplanationProps {
  question: Question
  selected_index: number
  is_last_question: boolean
  note_input_text: string
  onNoteChange: (text: string) => void
  onSaveQuestionNote: () => void
  onSaveSyndromeNote: (syndrome_id: string) => void
  onNext: () => void
}

export default function McqExplanation({
  question,
  selected_index,
  is_last_question,
  note_input_text,
  onNoteChange,
  onSaveQuestionNote,
  onSaveSyndromeNote,
  onNext,
}: McqExplanationProps) {
  const is_correct = selected_index === question.correct_index
  const correct_option = question.options[question.correct_index]

  return (
    <article className="card analysis">
      <h3 className={is_correct ? 'result_ok' : 'result_bad'}>
        {is_correct ? '作答正确' : '作答错误'}
      </h3>
      <div className="diagnosis_header">
        <span className="diagnosis_label">诊断</span>
        <span className="diagnosis_text">{question.explanation.diagnosis_text}</span>
      </div>
      <div className="analysis_block">
        <p className="analysis_title">正确答案</p>
        <p>
          {correct_option.key}. {question.explanation.correct_answer}
        </p>
      </div>
      <div className="analysis_block">
        <p className="analysis_title">辨证要点</p>
        <ul>
          {question.explanation.key_symptom_analysis.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="analysis_block">
        <p className="analysis_title">证机概要</p>
        <p>{question.explanation.pathogenesis}</p>
      </div>
      <div className="analysis_grid">
        <div className="analysis_block">
          <p className="analysis_title">治法</p>
          <p>{question.explanation.treatment_method}</p>
        </div>
        <div className="analysis_block">
          <p className="analysis_title">方药</p>
          <p>{question.explanation.prescription}</p>
        </div>
      </div>
      <div className="analysis_block">
        <p className="analysis_title">完整证候</p>
        <p>{question.explanation.full_symptoms}</p>
      </div>
      <div className="analysis_block">
        <p className="analysis_title">学习笔记</p>
        <textarea
          className="case_input"
          placeholder="记录本题易错点、辨证思路..."
          value={note_input_text}
          onChange={(event) => onNoteChange(event.target.value)}
        />
        <div className="action_row">
          <button className="secondary_btn" onClick={onSaveQuestionNote}>
            保存本题笔记
          </button>
          <button className="secondary_btn" onClick={() => onSaveSyndromeNote(question.syndrome_id)}>
            保存证型笔记
          </button>
        </div>
      </div>
      <button className="primary_btn full_btn" onClick={onNext}>
        {is_last_question ? '完成本轮练习' : '下一题'}
      </button>
    </article>
  )
}
