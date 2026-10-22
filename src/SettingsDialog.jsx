import { useEffect, useRef, useState } from 'react'
import { fetchModels } from './api.js'
import { MEDIA_KINDS, estimateCost, formatMediaPrice, formatPrice, formatUsd } from './aiSettings.js'
import ModelPicker from './ModelPicker.jsx'

const KINDS = ['text', ...MEDIA_KINDS]

// 저장할 때 남기는 값. 읽어 주기의 목소리·목소리 목록은 handleSave에서 붙인다
function toSaved(kind, m) {
  if (kind === 'text') {
    const { id, name, free, inputPrice, outputPrice } = m
    return { id, name, free, inputPrice, outputPrice }
  }
  const saved = { id: m.id, name: m.name, free: m.free, estimate: m.estimate, inputPrice: m.inputPrice, outputPrice: m.outputPrice }
  if (kind === 'transcription') saved.secondPrice = m.secondPrice
  return saved
}

// 톱니바퀴 설정 팝업: 다듬기(글)·사진 설명·이미지 그리기·읽어 주기·받아쓰기에 쓸 모델을 가격과 함께 고른다
export default function SettingsDialog({ open, model, mediaModels, onSave, onClose }) {
  const dialogRef = useRef(null)
  const current = { text: model, ...mediaModels }
  const currentIds = () => Object.fromEntries(KINDS.map((kind) => [kind, current[kind].id]))
  const [models, setModels] = useState({}) // { [kind]: 목록 }
  const [loadErrors, setLoadErrors] = useState({})
  const [selectedIds, setSelectedIds] = useState(currentIds)
  const [voice, setVoice] = useState(mediaModels.speech.voice ?? null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (open && !dialog.open) {
      setSelectedIds(currentIds())
      setVoice(mediaModels.speech.voice ?? null)
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
    // 열릴 때만 저장된 값으로 되돌린다 (저장된 모델이 바뀌어도 고르는 중인 값은 그대로 둔다)
  }, [open])

  // 처음 열 때 종류별로 한 번만 불러온다. 서로 기다리지 않고, 하나가 실패해도 나머지는 보인다
  // 실패한 종류는 다음에 열 때 다시 불러온다
  const requested = useRef(new Set())
  useEffect(() => {
    if (!open) return
    for (const kind of KINDS) {
      if (requested.current.has(kind)) continue
      requested.current.add(kind)
      setLoadErrors((prev) => ({ ...prev, [kind]: '' }))
      fetchModels(kind)
        .then((data) => setModels((prev) => ({ ...prev, [kind]: data })))
        .catch((err) => {
          requested.current.delete(kind)
          setLoadErrors((prev) => ({ ...prev, [kind]: err.message }))
        })
    }
  }, [open])

  // 목록을 불러오기 전에는 지금 저장된 모델 정보를 쓴다
  const selected = Object.fromEntries(
    KINDS.map((kind) => {
      const id = selectedIds[kind]
      return [kind, models[kind]?.find((m) => m.id === id) ?? (id === current[kind].id ? current[kind] : null)]
    }),
  )
  // 목록을 불러오기 전(저장된 값에 목소리 목록이 없을 때)에는 지금 목소리만 보여 준다
  const voices = selected.speech?.voices ?? (voice ? [voice] : [])
  const ready = KINDS.every((kind) => selected[kind])

  function select(kind, id) {
    setSelectedIds((prev) => ({ ...prev, [kind]: id }))
    // 읽어 주기 모델을 바꾸면 그 모델의 기본 목소리로 바꾼다
    if (kind === 'speech') setVoice(models.speech?.find((m) => m.id === id)?.defaultVoice ?? null)
  }

  function handleSave() {
    if (!ready) return
    const saved = Object.fromEntries(KINDS.map((kind) => [kind, toSaved(kind, selected[kind])]))
    saved.speech.voices = voices
    saved.speech.voice = voices.includes(voice) ? voice : null
    onSave(saved)
  }

  const picker = (kind, label, format) => (
    <ModelPicker
      name={`model-${kind}`}
      label={label}
      models={models[kind]}
      loadError={loadErrors[kind]}
      selectedId={selectedIds[kind]}
      onSelect={(id) => select(kind, id)}
      formatPrice={format}
    />
  )

  const paidWarning = (kind, text) =>
    selected[kind] &&
    !selected[kind].free && (
      <p className="paid-warning" role="alert">
        유료 모델입니다. {text} OpenRouter 크레딧에서 비용이 빠져나갑니다 (1회 약 {formatUsd(selected[kind].estimate)}).
      </p>
    )

  return (
    <dialog ref={dialogRef} className="settings" onClose={onClose} aria-labelledby="settings-title">
      <div className="settings-head">
        <h2 id="settings-title">AI 설정</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      <p className="settings-desc">
        기능마다 쓸 모델을 고르세요. 가격은 OpenRouter 기준이고, "가장 많이 씀"은 OpenRouter 순위, "가장 저렴"은 유료 모델 중 1회 예상 비용
        기준입니다.
      </p>

      <div className="settings-body">
        <section className="settings-section">
          <h3>글</h3>
          <p className="settings-hint">"AI로 다듬기"에 씁니다.</p>
          {picker('text', '글', formatPrice)}
          {selected.text && !selected.text.free && (
            <p className="paid-warning" role="alert">
              유료 모델입니다. 다듬을 때마다 OpenRouter 크레딧에서 비용이 빠져나갑니다 (1회 약 {formatUsd(estimateCost(selected.text))}).
            </p>
          )}
        </section>

        <section className="settings-section">
          <h3>이미지</h3>
          <p className="settings-hint">이미지 가격은 모델마다 계산 방식이 달라 대략값이에요.</p>

          <h4>사진 설명</h4>
          {picker('vision', '사진 설명', (m) => formatMediaPrice(m, 'vision'))}
          {paidWarning('vision', '사진을 설명할 때마다')}

          <h4>이미지 그리기</h4>
          {picker('image', '이미지 그리기', (m) => formatMediaPrice(m, 'image'))}
          {selected.image && !selected.image.free && (
            <p className="paid-warning" role="alert">
              유료 모델입니다. 그릴 때마다 OpenRouter 크레딧에서 비용이 빠져나갑니다 (1장 약 {formatUsd(selected.image.estimate)}).
            </p>
          )}
        </section>

        <section className="settings-section">
          <h3>읽어 주기</h3>
          <p className="settings-hint">카드의 "읽어 주기"에 씁니다. 가격은 100만 글자당이고, 1회는 300글자 기준 예상 비용이에요.</p>
          {picker('speech', '읽어 주기', (m) => formatMediaPrice(m, 'speech'))}
          <label className="voice-select">
            <span>목소리</span>
            {voices.length > 0 ? (
              <select value={voices.includes(voice) ? voice : ''} onChange={(e) => setVoice(e.target.value)}>
                {!voices.includes(voice) && <option value="">선택해 주세요</option>}
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <small>이 모델은 목소리를 고르지 않아요</small>
            )}
          </label>
          {paidWarning('speech', '읽어 줄 때마다')}
        </section>

        <section className="settings-section">
          <h3>받아쓰기</h3>
          <p className="settings-hint">새 아이디어 입력란의 "받아쓰기"에 씁니다. 가격은 녹음 초당이고, 1회는 30초 기준 예상 비용이에요.</p>
          {picker('transcription', '받아쓰기', (m) => formatMediaPrice(m, 'transcription'))}
          {paidWarning('transcription', '받아쓸 때마다')}
        </section>
      </div>

      <div className="settings-actions">
        <button type="button" className="button-secondary" onClick={onClose}>
          취소
        </button>
        <button type="button" className="button-primary" onClick={handleSave} disabled={!ready || (voices.length > 0 && !voices.includes(voice))}>
          저장
        </button>
      </div>
    </dialog>
  )
}
