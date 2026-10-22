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

// kind: text(다듬기) · vision(사진 설명) · image(이미지 그리기)
export function fetchModels(kind = 'text') {
  return request(`/api/ai/models?${new URLSearchParams({ kind })}`)
}

// 사진 설명·그리기는 결과만 받는다. 저장은 saveImage로 따로 한다
export function describePhoto(id, model, image) {
  return request('/api/ai/describe', { method: 'POST', body: JSON.stringify({ id, model, image }) })
}

export function drawImage(id, model) {
  return request('/api/ai/draw', { method: 'POST', body: JSON.stringify({ id, model }) })
}

export function saveImage(id, { kind, image, caption, model }) {
  return request(`/api/ideas/${encodeURIComponent(id)}/image`, {
    method: 'PUT',
    body: JSON.stringify({ kind, image, caption, model }),
  })
}

export function deleteImage(id) {
  return request(`/api/ideas/${encodeURIComponent(id)}/image`, { method: 'DELETE' })
}

// 읽어 주기: 응답이 JSON이 아니라 음성 파일이라 request를 쓰지 않는다. 재생할 주소(blob URL)를 돌려준다
export async function speakIdea(id, model, voice) {
  const res = await fetch('/api/ai/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, model, voice }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `요청에 실패했습니다. (${res.status})`)
  }
  return {
    url: URL.createObjectURL(await res.blob()),
    model: res.headers.get('X-AI-Model') ?? model,
    voice: res.headers.get('X-AI-Voice') || null,
    cost: Number(res.headers.get('X-AI-Cost')) || 0,
  }
}

// 받아쓰기: 녹음(base64)을 보내 { text, model, seconds, cost }를 받는다
export function listenAudio({ audio, format, model }) {
  return request('/api/ai/listen', { method: 'POST', body: JSON.stringify({ audio, format, model }) })
}

// 오늘의 브리핑: { text, sources, model, cost, audio: { url, model, voice, cost } | null, audioError }
export function createBriefing({ symbols, model, speechModel, voice }) {
  return request('/api/briefing', { method: 'POST', body: JSON.stringify({ symbols, model, speechModel, voice }) })
}

export function fetchIdea(id) {
  return request(`/api/ideas/${encodeURIComponent(id)}`)
}

// 활용 장면 영상: 시나리오·예상 금액만 받는다 (영상은 createVideo를 눌러야 만든다)
export function planVideo(id, model, textModel) {
  return request('/api/ai/video/plan', { method: 'POST', body: JSON.stringify({ id, model, textModel }) })
}

// 작업만 제출하고 status: generating인 카드를 돌려받는다. 완료는 fetchIdea로 다시 읽어 확인한다
export function createVideo(id, { model, before, after, prompt, duration, audio, firstFrame }) {
  return request(`/api/ideas/${encodeURIComponent(id)}/video`, {
    method: 'POST',
    body: JSON.stringify({ model, before, after, prompt, duration, audio, firstFrame }),
  })
}

export function deleteVideo(id) {
  return request(`/api/ideas/${encodeURIComponent(id)}/video`, { method: 'DELETE' })
}

// 다듬은 결과만 받는다. 저장은 applyProposal로 따로 한다
export function refineIdea(id, model) {
  return request('/api/ai/refine', { method: 'POST', body: JSON.stringify({ id, model }) })
}

export function applyProposal(id, proposal) {
  return request(`/api/ideas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ proposal }) })
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
