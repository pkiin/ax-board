// 다듬기에 쓸 모델은 브라우저에 저장한다. 유료 여부를 카드에서 바로 알 수 있게 가격도 함께 둔다
const STORAGE_KEY = 'ax-board.ai-model.v1'

export const DEFAULT_MODEL = {
  id: 'openrouter/free',
  name: 'Free Models Router',
  free: true,
  inputPrice: 0,
  outputPrice: 0,
}

// 다듬기 1회 예상 토큰 (입력: 지시문 + 아이디어, 출력: 기획안 + 추론)
const ESTIMATE_INPUT_TOKENS = 700
const ESTIMATE_OUTPUT_TOKENS = 1500

export function loadModel() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (saved && typeof saved.id === 'string' && typeof saved.free === 'boolean') return saved
  } catch {
    // 읽지 못하면 기본 모델
  }
  return DEFAULT_MODEL
}

export function saveModel(model) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model))
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 쓴다
  }
}

// 가격은 100만 토큰당 USD
export function estimateCost(model) {
  return (ESTIMATE_INPUT_TOKENS * model.inputPrice + ESTIMATE_OUTPUT_TOKENS * model.outputPrice) / 1_000_000
}

export function formatUsd(value) {
  if (value === 0) return '$0'
  if (value < 0.0001) return '$0.0001 미만'
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
}

export function formatPrice(model) {
  if (model.free) return '무료'
  const price = (v) => `$${Number(v.toFixed(4))}`
  return `입력 ${price(model.inputPrice)} · 출력 ${price(model.outputPrice)} / 100만 토큰`
}
