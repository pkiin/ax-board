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

// 사진 설명(vision)·이미지 그리기(image)·읽어 주기(speech)·받아쓰기(transcription) 모델
// 1회 예상 비용(estimate, USD)은 서버가 계산해 준다. 읽어 주기는 고른 목소리(voice)도 함께 둔다
const MEDIA_STORAGE_KEY = 'ax-board.ai-media-models.v1'
export const MEDIA_KINDS = ['vision', 'image', 'speech', 'transcription']

export const DEFAULT_MEDIA_MODELS = {
  vision: {
    id: 'minimax/minimax-m3.1-flash:free',
    name: 'MiniMax: MiniMax M3.1 Flash (free)',
    free: true,
    estimate: 0,
  },
  image: {
    id: 'google/gemini-3.1-flash-image',
    name: 'Google: Nano Banana 2 (Gemini 3.1 Flash Image)',
    free: false,
    estimate: 0.077,
  },
  speech: {
    id: 'elevenlabs/eleven-v4-turbo',
    name: 'ElevenLabs: Eleven v4 Turbo',
    free: false,
    estimate: 0.012,
    inputPrice: 40,
    outputPrice: 0,
    voice: 'sarah',
  },
  transcription: {
    id: 'openai/whisper-large-v3-turbo',
    name: 'OpenAI: Whisper Large V3 Turbo',
    free: false,
    estimate: 0.0001,
    outputPrice: 0,
    secondPrice: 0.00000333,
  },
}

export function loadMediaModels() {
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(MEDIA_STORAGE_KEY))
  } catch {
    // 읽지 못하면 기본 모델
  }
  const valid = (m) => m && typeof m.id === 'string' && typeof m.free === 'boolean' && typeof m.estimate === 'number'
  return Object.fromEntries(MEDIA_KINDS.map((kind) => [kind, valid(saved?.[kind]) ? saved[kind] : DEFAULT_MEDIA_MODELS[kind]]))
}

export function saveMediaModels(models) {
  try {
    localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(models))
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 쓴다
  }
}

// 아주 작은 단가도 읽을 수 있게 유효 숫자 3자리까지 쓴다 (예: 0.00000333)
function formatRate(value) {
  if (value === 0) return '$0'
  const digits = Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(value))))
  return `$${Number(value.toFixed(digits))}`
}

// 읽어 주기는 100만 글자당, 받아쓰기는 초당 가격. 그 밖에는 1회(1장) 예상 비용
export function formatMediaPrice(model, kind) {
  if (model.free) return '무료'
  if (kind === 'speech') {
    const audio = model.outputPrice > 0 ? ` + 오디오 출력 ${formatRate(model.outputPrice)}/100만 토큰` : ''
    return `100만 글자당 ${formatRate(model.inputPrice)}${audio}`
  }
  if (kind === 'transcription') {
    // 토큰 가격 모델은 서버가 초당 가격을 어림한다
    return `초당 ${model.outputPrice > 0 ? '약 ' : ''}${formatRate(model.secondPrice)}`
  }
  return `${kind === 'image' ? '1장' : '1회'} 약 ${formatUsd(model.estimate)}`
}

export function formatPrice(model) {
  if (model.free) return '무료'
  const price = (v) => `$${Number(v.toFixed(4))}`
  return `입력 ${price(model.inputPrice)} · 출력 ${price(model.outputPrice)} / 100만 토큰`
}
