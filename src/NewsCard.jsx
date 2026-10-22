import { useEffect, useState } from 'react'
import { fetchNews } from './api.js'

const DEFAULT_QUERY = '천안 AX'
// 백엔드(server/index.js)의 MAX_QUERY와 같은 값
const MAX_QUERY = 50

function formatDate(iso) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  })
}

// 뉴스는 날씨·아이디어 목록과 따로 불러온다. 검색어는 카드 안에서 바꾼다.
export default function NewsCard() {
  const [input, setInput] = useState(DEFAULT_QUERY)
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [news, setNews] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    setNews(null)
    setError('')
    fetchNews(query)
      .then((data) => !ignore && setNews(data))
      .catch((err) => !ignore && setError(err.message))
    return () => {
      ignore = true
    }
  }, [query])

  function handleSubmit(event) {
    event.preventDefault()
    const next = input.trim()
    if (!next) {
      setError('검색어를 입력해 주세요.')
      return
    }
    setInput(next)
    setQuery(next)
  }

  return (
    <section className="widget" aria-label="뉴스">
      <h3 className="widget-title">뉴스</h3>

      <form className="news-search" onSubmit={handleSubmit}>
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={MAX_QUERY}
          aria-label="뉴스 검색어"
        />
        <button type="submit">검색</button>
      </form>

      {error ? (
        <p className="widget-message error">{error}</p>
      ) : !news ? (
        <p className="widget-message">불러오는 중…</p>
      ) : news.length === 0 ? (
        <p className="widget-message">검색 결과가 없어요</p>
      ) : (
        <ul className="news-list">
          {news.map((item) => (
            <li key={item.link}>
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
              {item.date && <span className="news-date">{formatDate(item.date)}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="widget-source">네이버 뉴스 · 최신순</p>
    </section>
  )
}
