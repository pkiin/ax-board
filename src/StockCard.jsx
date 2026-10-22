import { useEffect, useState } from 'react'
import { fetchStocks } from './api.js'

const STORAGE_KEY = 'ax-board.stocks.v1'
const DEFAULT_SYMBOLS = ['MSFT', 'AAPL', 'NVDA', 'GOOGL']
// 백엔드(server/index.js)의 MAX_SYMBOLS, SYMBOL_PATTERN과 같은 규칙
const MAX_SYMBOLS = 6
const SYMBOL_PATTERN = /^[A-Z0-9.:-]{1,15}$/

// 저장된 목록이 없거나 깨져 있으면 기본 종목을 쓴다 (오늘의 브리핑도 이 목록을 쓴다)
export function loadSymbols() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (Array.isArray(saved) && saved.every((s) => typeof s === 'string' && SYMBOL_PATTERN.test(s))) {
      return saved.slice(0, MAX_SYMBOLS)
    }
  } catch {
    // 읽지 못하면 기본 종목
  }
  return DEFAULT_SYMBOLS
}

function saveSymbols(symbols) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols))
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 쓴다
  }
}

function QuoteValue({ quote }) {
  if (!quote) return <span className="stock-note">…</span>
  if (quote.error) return <span className="stock-note error">불러오지 못함</span>
  if (!quote.found) return <span className="stock-note">찾을 수 없음</span>

  const direction = quote.changePct > 0 ? 'up' : quote.changePct < 0 ? 'down' : 'flat'
  const arrow = { up: '▲', down: '▼', flat: '' }[direction]
  return (
    <>
      <span className="stock-price">${quote.price.toFixed(2)}</span>
      <span className={`stock-change ${direction}`}>
        {arrow} {Math.abs(quote.changePct).toFixed(2)}%
      </span>
    </>
  )
}

// 시세는 날씨·뉴스와 따로 불러온다. 실패해도 다른 카드에는 영향이 없다.
export default function StockCard() {
  const [symbols, setSymbols] = useState(loadSymbols)
  const [quotes, setQuotes] = useState({}) // symbol → 응답 한 줄
  const [loadError, setLoadError] = useState('')
  const [input, setInput] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)

  // 처음 열 때 저장된 종목을 한 번에 불러온다. 추가·삭제 때는 그 종목만 다룬다.
  useEffect(() => {
    let ignore = false
    const initial = loadSymbols()
    if (initial.length === 0) return
    fetchStocks(initial)
      .then((list) => !ignore && setQuotes(Object.fromEntries(list.map((q) => [q.symbol, q]))))
      .catch((err) => !ignore && setLoadError(err.message))
    return () => {
      ignore = true
    }
  }, [])

  function updateSymbols(next) {
    setSymbols(next)
    saveSymbols(next)
  }

  async function handleAdd(event) {
    event.preventDefault()
    const symbol = input.trim().toUpperCase()
    setAddError('')
    if (!symbol) return setAddError('종목 기호를 입력해 주세요.')
    if (!SYMBOL_PATTERN.test(symbol)) return setAddError('종목 기호 형식이 올바르지 않아요.')
    if (symbols.includes(symbol)) return setAddError('이미 있는 종목이에요.')
    if (symbols.length >= MAX_SYMBOLS) return setAddError(`종목은 최대 ${MAX_SYMBOLS}개까지 추가할 수 있어요.`)

    setAdding(true)
    try {
      const [quote] = await fetchStocks([symbol])
      if (!quote.found) {
        setAddError('찾을 수 없는 종목이에요')
        return
      }
      setQuotes((prev) => ({ ...prev, [symbol]: quote }))
      updateSymbols([...symbols, symbol])
      setInput('')
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
    }
  }

  function handleRemove(symbol) {
    updateSymbols(symbols.filter((s) => s !== symbol))
  }

  const full = symbols.length >= MAX_SYMBOLS

  return (
    <section className="widget" aria-label="주가">
      <h3 className="widget-title">
        주가 <span className="count">{symbols.length}/{MAX_SYMBOLS}</span>
      </h3>

      {loadError && <p className="widget-message error">{loadError}</p>}

      {symbols.length === 0 ? (
        <p className="widget-message">종목을 추가해 보세요</p>
      ) : (
        <ul className="stock-list">
          {symbols.map((symbol) => (
            <li key={symbol}>
              <span className="stock-symbol">{symbol}</span>
              <span className="stock-value">
                <QuoteValue quote={quotes[symbol] ?? (loadError ? { error: true } : null)} />
              </span>
              <button type="button" className="stock-remove" onClick={() => handleRemove(symbol)} aria-label={`${symbol} 삭제`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="news-search stock-add" onSubmit={handleAdd}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={15}
          placeholder={full ? `최대 ${MAX_SYMBOLS}종목` : '종목 기호 (예: TSLA)'}
          aria-label="추가할 종목 기호"
          disabled={full}
        />
        <button type="submit" disabled={adding || full}>
          {adding ? '확인 중' : '추가'}
        </button>
      </form>
      {addError && <p className="widget-message error stock-add-error">{addError}</p>}

      <p className="widget-source">Finnhub · 전일 종가 대비</p>
    </section>
  )
}
