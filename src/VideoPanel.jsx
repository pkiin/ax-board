import { useState } from 'react'
import { formatUsd, videoCost } from './aiSettings.js'

// 서버(server/index.js)와 같은 길이 규칙
const MAX_SCENE = 300
const MAX_VIDEO_PROMPT = 2000

// 활용 장면 영상 시나리오: 고칠 수 있게 보여 주고, "만들기"를 누를 때만 영상을 만든다
export default function VideoPanel({ plan, firstFrameUrl, creating, error, onCreate, onCancel }) {
  const { model } = plan
  const [before, setBefore] = useState(plan.scenario.before)
  const [after, setAfter] = useState(plan.scenario.after)
  const [prompt, setPrompt] = useState(plan.scenario.prompt)
  const [duration, setDuration] = useState(plan.scenario.duration)
  const [audio, setAudio] = useState(model.audio)
  const [formError, setFormError] = useState('')

  const cost = videoCost(model, duration, audio)

  function handleCreate() {
    const values = { before: before.trim(), after: after.trim(), prompt: prompt.trim(), duration, audio }
    if (!values.before || !values.after || !values.prompt) {
      setFormError('도입 전·후 장면과 영상 프롬프트를 모두 입력해 주세요.')
      return
    }
    setFormError('')
    onCreate(values, cost)
  }

  return (
    <div className="refine video-panel">
      <h4>활용 장면 영상 시나리오</h4>
      <div className="video-plan">
        <figure className="video-first-frame">
          <img src={firstFrameUrl} alt="첫 장면 (카드 대표 이미지)" />
          <figcaption>첫 장면: 카드 대표 이미지 (16:9로 잘라 씁니다)</figcaption>
        </figure>

        <label className="field">
          <span className="field-label">도입 전 장면 (대상 업무)</span>
          <textarea value={before} onChange={(e) => setBefore(e.target.value)} rows={2} maxLength={MAX_SCENE} disabled={creating} />
        </label>
        <label className="field">
          <span className="field-label">도입 후 장면 (AI 활용 아이디어)</span>
          <textarea value={after} onChange={(e) => setAfter(e.target.value)} rows={2} maxLength={MAX_SCENE} disabled={creating} />
        </label>
        <label className="field">
          <span className="field-label">영상용 프롬프트 (영어로 쓰면 더 잘 통해요)</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={MAX_VIDEO_PROMPT} disabled={creating} />
        </label>

        <div className="video-options">
          <label>
            길이
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={creating}>
              {model.durations.map((d) => (
                <option key={d} value={d}>
                  {d}초
                </option>
              ))}
            </select>
          </label>
          {model.audio && (
            <label>
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} disabled={creating} /> 소리 포함
            </label>
          )}
          <span className="video-cost">
            예상 금액 <strong>약 {formatUsd(cost)}</strong>
          </span>
        </div>
        <p className="refine-meta">
          {model.name} · {model.resolution} · 16:9 · 시나리오 {plan.textModel} (비용 {formatUsd(plan.cost)}) · 만드는 데 몇 분 걸려요
        </p>
      </div>

      {(formError || error) && <p className="error">{formError || error}</p>}
      <div className="refine-actions">
        <button type="button" className="button-secondary" onClick={onCancel} disabled={creating}>
          취소
        </button>
        <button type="button" className="button-primary" onClick={handleCreate} disabled={creating}>
          {creating ? '요청 중…' : `만들기 (약 ${formatUsd(cost)})`}
        </button>
      </div>
    </div>
  )
}
