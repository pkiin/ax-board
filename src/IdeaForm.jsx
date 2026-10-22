import { useState } from 'react'
import { createId } from './id.js'
import DictateButton from './DictateButton.jsx'

const EMPTY = { title: '', target: '', idea: '' }
const MAX_TEXT = 80 // 제목·대상 업무 (서버와 같은 길이)
const MAX_IDEA = 2000

export default function IdeaForm({ onAdd, transcriptionModel }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleChange(event) {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  // 받아쓴 글은 지금 입력한 내용 뒤에 이어 붙인다
  function appendText(name, text) {
    setForm((prev) => {
      const joined = prev[name].trim() ? `${prev[name].trimEnd()} ${text}` : text
      return { ...prev, [name]: joined.slice(0, name === 'idea' ? MAX_IDEA : MAX_TEXT) }
    })
  }

  const dictate = (name, label) => (
    <DictateButton model={transcriptionModel} label={label} onText={(text) => appendText(name, text)} />
  )

  async function handleSubmit(event) {
    event.preventDefault()

    const title = form.title.trim()
    const target = form.target.trim()
    const idea = form.idea.trim()

    if (!title || !target || !idea) {
      setError('제목, 대상 업무, AI 활용 아이디어를 모두 입력해 주세요.')
      return
    }

    setSubmitting(true)
    try {
      await onAdd({
        id: createId(),
        title,
        target,
        idea,
        createdAt: new Date().toISOString(),
      })
      setForm(EMPTY)
      setError('')
    } catch (err) {
      // 저장에 실패하면 입력 내용을 지우지 않고 다시 시도할 수 있게 둔다
      setError(`저장하지 못했습니다. ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <h2 className="form-title">새 아이디어 추가</h2>

      <label className="field">
        <span className="field-label">
          제목 {dictate('title', '제목')}
        </span>
        <input
          name="title"
          value={form.title}
          onChange={handleChange}
          placeholder="예) 월간 보고서 초안 자동 작성"
          maxLength={MAX_TEXT}
        />
      </label>

      <label className="field">
        <span className="field-label">
          대상 업무 {dictate('target', '대상 업무')}
        </span>
        <input
          name="target"
          value={form.target}
          onChange={handleChange}
          placeholder="예) 영업팀 월간 실적 보고"
          maxLength={MAX_TEXT}
        />
      </label>

      <label className="field">
        <span className="field-label">
          AI 활용 아이디어 {dictate('idea', 'AI 활용 아이디어')}
        </span>
        <textarea
          name="idea"
          value={form.idea}
          onChange={handleChange}
          rows={4}
          placeholder="예) 실적 데이터를 요약해 보고서 초안을 생성하고, 담당자는 검토만 진행"
        />
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" className="submit" disabled={submitting}>
        {submitting ? '저장 중…' : '아이디어 추가'}
      </button>
    </form>
  )
}
