import { useState } from 'react'
import { createBriefing } from './api.js'
import { estimateCost, formatUsd } from './aiSettings.js'
import { loadSymbols } from './StockCard.jsx'

const SOURCE_LABELS = { weather: '날씨', news: '뉴스', stocks: '주가' }

// 오늘의 브리핑: 날씨·뉴스·주가(내 종목)를 서버가 동시에 모아 글과 음성으로 만든다
export default function BriefingCard({ aiModel, speechModel }) {
  const [briefing, setBriefing] = useState(null) // { text, sources, model, cost, audio, audioError }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const paid = !aiModel.free || !speechModel.free
  // 글 길이는 읽어 주기 1회(300자)와 비슷해 그 예상 비용을 그대로 쓴다
  const estimate = estimateCost(aiModel) + speechModel.estimate

  async function handleBriefing() {
    if (paid && !window.confirm(`유료 모델이 포함되어 있습니다. 1회 약 ${formatUsd(estimate)}가 듭니다. 브리핑을 만들까요?`)) return
    setLoading(true)
    setError('')
    try {
      // 주가는 주가 카드에 저장된 내 종목 목록을 쓴다
      setBriefing(
        await createBriefing({
          symbols: loadSymbols(),
          model: aiModel.id,
          speechModel: speechModel.id,
          voice: speechModel.voice ?? undefined,
        }),
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="widget briefing" aria-label="오늘의 브리핑">
      <h3 className="widget-title">오늘의 브리핑</h3>
      <button type="button" className="briefing-button" onClick={handleBriefing} disabled={loading}>
        {loading ? '브리핑 만드는 중…' : briefing ? '다시 만들기' : '🎧 오늘의 브리핑'}
        {paid && <span className="paid-badge">유료</span>}
      </button>
      {loading && <p className="widget-message">날씨·뉴스·주가를 모아 글과 음성으로 만들고 있어요 (30초쯤 걸려요)</p>}
      {error && <p className="widget-message error">{error}</p>}

      {briefing && !loading && (
        <>
          <ul className="briefing-sources" aria-label="브리핑에 쓴 정보">
            {Object.entries(SOURCE_LABELS).map(([key, label]) => (
              <li key={key} className={briefing.sources[key] ? 'ok' : 'missing'}>
                {label} {briefing.sources[key] ? '✓' : '정보 없음'}
              </li>
            ))}
          </ul>
          <p className="briefing-text">{briefing.text}</p>
          {briefing.audio ? (
            <audio className="briefing-audio" src={briefing.audio.url} controls />
          ) : (
            <p className="widget-message error">{briefing.audioError}</p>
          )}
          <p className="widget-source">
            {briefing.model}
            {briefing.audio && ` · ${briefing.audio.model}${briefing.audio.voice ? ` (${briefing.audio.voice})` : ''}`} · 비용 약{' '}
            {formatUsd(briefing.cost + (briefing.audio?.cost ?? 0))}
          </p>
        </>
      )}
    </section>
  )
}
