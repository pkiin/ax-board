import { useEffect, useState } from 'react'
import { fetchStock } from './api.js'

const SYMBOL = 'AAPL'

// 시세는 날씨·뉴스와 따로 불러온다. 실패해도 다른 카드에는 영향이 없다.
export default function StockCard() {
  const [quote, setQuote] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    fetchStock(SYMBOL)
      .then((data) => !ignore && setQuote(data))
      .catch((err) => !ignore && setError(err.message))
    return () => {
      ignore = true
    }
  }, [])

  const direction = !quote || quote.changePct === 0 ? 'flat' : quote.changePct > 0 ? 'up' : 'down'
  const arrow = { up: '▲', down: '▼', flat: '' }[direction]

  return (
    <section className="widget" aria-label="주가">
      <h3 className="widget-title">주가 · {SYMBOL}</h3>

      {error ? (
        <p className="widget-message error">{error}</p>
      ) : !quote ? (
        <p className="widget-message">불러오는 중…</p>
      ) : (
        <p className="stock-now">
          <span className="stock-price">${quote.price.toFixed(2)}</span>
          <span className={`stock-change ${direction}`}>
            {arrow} {Math.abs(quote.changePct).toFixed(2)}%
          </span>
        </p>
      )}

      <p className="widget-source">Finnhub · 전일 종가 대비</p>
    </section>
  )
}
