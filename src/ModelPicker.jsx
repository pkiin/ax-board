import { useMemo, useState } from 'react'

// 설정 팝업의 모델 목록 하나: 검색·무료만 보기·가격, 기본/가장 많이 씀/가장 저렴 배지
export default function ModelPicker({ name, label, models, loadError, selectedId, onSelect, formatPrice }) {
  const [search, setSearch] = useState('')
  const [freeOnly, setFreeOnly] = useState(false)

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return (models ?? []).filter(
      (m) => (!freeOnly || m.free) && (!keyword || m.name.toLowerCase().includes(keyword) || m.id.toLowerCase().includes(keyword)),
    )
  }, [models, search, freeOnly])

  return (
    <>
      <div className="settings-filter">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="모델 검색" aria-label={`${label} 모델 검색`} />
        <label>
          <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> 무료만 보기
        </label>
      </div>

      <div className="model-list" role="radiogroup" aria-label={`${label} 모델 목록`}>
        {loadError ? (
          <p className="widget-message error">{loadError}</p>
        ) : !models ? (
          <p className="widget-message">모델 목록을 불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="widget-message">맞는 모델이 없어요</p>
        ) : (
          filtered.map((m) => (
            <label key={m.id} className={`model-option${m.id === selectedId ? ' selected' : ''}`}>
              <input type="radio" name={name} value={m.id} checked={m.id === selectedId} onChange={() => onSelect(m.id)} />
              <span className="model-name">
                {m.name}
                {(m.default || m.popular || m.cheapest) && (
                  <span className="model-badges">
                    {m.default && <span className="model-badge default">기본</span>}
                    {m.popular && <span className="model-badge popular">가장 많이 씀</span>}
                    {m.cheapest && <span className="model-badge cheapest">가장 저렴</span>}
                  </span>
                )}
                <small>{m.id}</small>
              </span>
              <span className={`model-price${m.free ? ' free' : ''}`}>{formatPrice(m)}</span>
            </label>
          ))
        )}
      </div>
    </>
  )
}
