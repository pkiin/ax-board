import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchModels } from './api.js'
import { estimateCost, formatPrice, formatUsd } from './aiSettings.js'

// 톱니바퀴 설정 팝업: 다듬기에 쓸 모델을 가격과 함께 고른다
export default function SettingsDialog({ open, model, onSave, onClose }) {
  const dialogRef = useRef(null)
  const [models, setModels] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(model.id)
  const [search, setSearch] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (open && !dialog.open) {
      setSelectedId(model.id)
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open, model.id])

  // 처음 열 때 한 번만 목록을 불러온다
  useEffect(() => {
    if (!open || models) return
    let ignore = false
    setLoadError('')
    fetchModels()
      .then((data) => !ignore && setModels(data))
      .catch((err) => !ignore && setLoadError(err.message))
    return () => {
      ignore = true
    }
  }, [open, models])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return (models ?? []).filter(
      (m) => (!freeOnly || m.free) && (!keyword || m.name.toLowerCase().includes(keyword) || m.id.toLowerCase().includes(keyword)),
    )
  }, [models, search, freeOnly])

  // 목록을 불러오기 전에는 지금 저장된 모델 정보를 쓴다
  const selected = models?.find((m) => m.id === selectedId) ?? (selectedId === model.id ? model : null)

  function handleSave() {
    if (!selected) return
    const { id, name, free, inputPrice, outputPrice } = selected
    onSave({ id, name, free, inputPrice, outputPrice })
  }

  return (
    <dialog ref={dialogRef} className="settings" onClose={onClose} aria-labelledby="settings-title">
      <div className="settings-head">
        <h2 id="settings-title">AI 설정</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      <p className="settings-desc">"AI로 다듬기"에 쓸 모델을 고르세요. 가격은 OpenRouter 기준입니다.</p>

      <div className="settings-filter">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="모델 검색" aria-label="모델 검색" />
        <label>
          <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> 무료만 보기
        </label>
      </div>

      <div className="model-list" role="radiogroup" aria-label="모델 목록">
        {loadError ? (
          <p className="widget-message error">{loadError}</p>
        ) : !models ? (
          <p className="widget-message">모델 목록을 불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="widget-message">맞는 모델이 없어요</p>
        ) : (
          filtered.map((m) => (
            <label key={m.id} className={`model-option${m.id === selectedId ? ' selected' : ''}`}>
              <input type="radio" name="model" value={m.id} checked={m.id === selectedId} onChange={() => setSelectedId(m.id)} />
              <span className="model-name">
                {m.name}
                <small>{m.id}</small>
              </span>
              <span className={`model-price${m.free ? ' free' : ''}`}>{formatPrice(m)}</span>
            </label>
          ))
        )}
      </div>

      {selected && !selected.free && (
        <p className="paid-warning" role="alert">
          유료 모델입니다. 다듬을 때마다 OpenRouter 크레딧에서 비용이 빠져나갑니다 (1회 약 {formatUsd(estimateCost(selected))}).
        </p>
      )}

      <div className="settings-actions">
        <button type="button" className="button-secondary" onClick={onClose}>
          취소
        </button>
        <button type="button" className="button-primary" onClick={handleSave} disabled={!selected}>
          저장
        </button>
      </div>
    </dialog>
  )
}
