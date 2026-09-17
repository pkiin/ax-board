const STORAGE_KEY = 'ax-board.ideas.v1'

export function loadIdeas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveIdeas(ideas) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas))
  } catch {
    // 저장 공간이 없거나 접근이 차단된 경우 화면 동작은 그대로 유지한다
  }
}
