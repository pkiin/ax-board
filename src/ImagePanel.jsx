import { formatUsd } from './aiSettings.js'

// 사진 설명·그린 이미지를 미리 보여 주고, 적용 여부를 고르게 한다
export default function ImagePanel({ pending, replacing, applying, error, onApply, onCancel }) {
  return (
    <div className="refine image-panel">
      <h4>{pending.kind === 'photo' ? 'AI 사진 설명' : 'AI가 그린 대표 이미지'}</h4>
      <figure className="card-figure">
        <img src={pending.image} alt={pending.caption ?? '미리보기'} />
        {pending.caption && <figcaption>{pending.caption}</figcaption>}
      </figure>
      <p className="refine-meta">
        {pending.model} · 비용 {formatUsd(pending.cost)}
        {replacing && ' · 적용하면 지금 이미지를 바꿉니다'}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="refine-actions">
        <button type="button" className="button-secondary" onClick={onCancel} disabled={applying}>
          취소
        </button>
        <button type="button" className="button-primary" onClick={onApply} disabled={applying}>
          {applying ? '저장 중…' : '적용'}
        </button>
      </div>
    </div>
  )
}
