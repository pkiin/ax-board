// 이전 버전이 브라우저에 저장하던 키. 서버로 옮긴 뒤 삭제한다.
const LEGACY_STORAGE_KEY = 'ax-board.ideas.v1'

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `요청에 실패했습니다. (${res.status})`)
  }
  return res.status === 204 ? null : res.json()
}

export function fetchIdeas() {
  return request('/api/ideas')
}

export function createIdea(idea) {
  return request('/api/ideas', { method: 'POST', body: JSON.stringify(idea) })
}

export function deleteIdea(id) {
  return request(`/api/ideas/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function fetchWeather() {
  return request('/api/weather')
}

export function fetchNews(query) {
  return request(`/api/news?${new URLSearchParams({ q: query })}`)
}

export function fetchStocks(symbols) {
  return request(`/api/stock?${new URLSearchParams({ s: symbols.join(',') })}`)
}

// localStorage에 남아 있는 예전 아이디어를 서버로 한 번 옮긴다.
// 같은 id는 서버에서 중복 저장하지 않으므로 중간에 실패해도 다시 시도하면 된다.
export async function migrateLegacyIdeas() {
  let legacy
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]')
  } catch {
    return
  }
  if (!Array.isArray(legacy) || legacy.length === 0) return

  let failed = false
  for (const idea of legacy) {
    try {
      await createIdea(idea)
    } catch {
      failed = true
    }
  }
  if (failed) return
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // 지우지 못해도 다음 이전 때 중복 저장되지 않으므로 무시한다
  }
}
