import http from 'node:http'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// 백엔드 포트는 계정별 프런트 포트($PORT) + 100 (예: user99 → 3199)
const FRONT_PORT = Number(process.env.PORT)
if (!process.env.PORT || !Number.isInteger(FRONT_PORT)) {
  console.error('PORT 환경 변수가 없습니다. 계정별 포트($PORT)를 확인해 주세요.')
  process.exit(1)
}
const API_PORT = FRONT_PORT + 100

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL이 없습니다. .env 파일을 확인해 주세요.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const MAX_TEXT = 80
const MAX_IDEA = 2000

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      target     TEXT NOT NULL,
      idea       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // AI로 다듬은 기획안. 이미 있는 테이블에도 열을 추가한다
  await pool.query('ALTER TABLE ideas ADD COLUMN IF NOT EXISTS proposal JSONB')
  // 카드 대표 이미지 (카드당 한 장). 목록 응답이 무거워지지 않게 따로 두고 파일은 GET /api/ideas/:id/image로 준다
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idea_images (
      idea_id    TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      mime       TEXT NOT NULL,
      data       BYTEA NOT NULL,
      caption    TEXT,
      model      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // 활용 장면 영상 (카드당 한 개). 만드는 데 몇 분 걸려 작업 상태를 저장하고 서버가 백그라운드에서 확인한다
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idea_videos (
      idea_id     TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
      status      TEXT NOT NULL,
      job_id      TEXT NOT NULL,
      polling_url TEXT NOT NULL,
      model       TEXT NOT NULL,
      prompt      TEXT NOT NULL,
      scenario    JSONB,
      duration    INTEGER NOT NULL,
      audio       BOOLEAN NOT NULL,
      estimate    NUMERIC,
      cost        NUMERIC,
      mime        TEXT,
      data        BYTEA,
      error       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    )
  `)
}

// 아이디어와 대표 이미지·영상 정보(파일 제외)를 함께 읽는다
const IDEA_SELECT = `
  SELECT i.*, im.kind AS image_kind, im.caption AS image_caption, im.created_at AS image_at,
    iv.status AS video_status, iv.model AS video_model, iv.duration AS video_duration, iv.audio AS video_audio,
    iv.scenario AS video_scenario, iv.estimate AS video_estimate, iv.cost AS video_cost, iv.error AS video_error,
    iv.created_at AS video_created_at, iv.finished_at AS video_finished_at
  FROM ideas i
  LEFT JOIN idea_images im ON im.idea_id = i.id
  LEFT JOIN idea_videos iv ON iv.idea_id = i.id`

async function findIdea(id) {
  const { rows } = await pool.query(`${IDEA_SELECT} WHERE i.id = $1`, [id])
  return rows[0] ? toIdea(rows[0]) : null
}

function toIdea(row) {
  return {
    id: row.id,
    title: row.title,
    target: row.target,
    idea: row.idea,
    createdAt: row.created_at.toISOString(),
    proposal: row.proposal ?? null,
    // 이미지를 바꾸면 주소가 바뀌도록 저장 시각을 붙인다 (브라우저 캐시)
    image: row.image_kind
      ? {
          kind: row.image_kind,
          caption: row.image_caption ?? null,
          url: `/api/ideas/${encodeURIComponent(row.id)}/image?v=${row.image_at.getTime()}`,
        }
      : null,
    // status: generating(만드는 중) · ready(재생 가능, url) · failed(error)
    video: row.video_status
      ? {
          status: row.video_status,
          model: row.video_model,
          duration: row.video_duration,
          audio: row.video_audio,
          scenario: row.video_scenario ?? null,
          estimate: row.video_estimate === null ? null : Number(row.video_estimate),
          cost: row.video_cost === null ? null : Number(row.video_cost),
          error: row.video_error ?? null,
          createdAt: row.video_created_at.toISOString(),
          url:
            row.video_status === 'ready'
              ? `/api/ideas/${encodeURIComponent(row.id)}/video?v=${row.video_finished_at.getTime()}`
              : null,
        }
      : null,
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

function readJson(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > limit) {
        reject(new Error('too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

// 프런트(IdeaForm)와 같은 규칙: 세 필드 trim 후 필수
function validate(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  const idea = typeof body.idea === 'string' ? body.idea.trim() : ''
  if (!title || !target || !idea) return { error: '제목, 대상 업무, AI 활용 아이디어를 모두 입력해 주세요.' }
  if (title.length > MAX_TEXT || target.length > MAX_TEXT || idea.length > MAX_IDEA) {
    return { error: '입력 길이가 너무 깁니다.' }
  }

  const id = typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 64 ? body.id : randomUUID()
  const date = new Date(body.createdAt)
  const createdAt = Number.isNaN(date.getTime()) ? new Date() : date
  return { value: { id, title, target, idea, createdAt } }
}

// 기상청 초단기실황 (천안 격자 nx 62, ny 110)
const KMA_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst'
const CHEONAN = { name: '천안', nx: 62, ny: 110 }
const WEATHER_TTL = 10 * 60 * 1000
const PTY_TEXT = { 0: '강수 없음', 1: '비', 2: '비/눈', 3: '눈', 5: '빗방울', 6: '빗방울눈날림', 7: '눈날림' }
const WIND_DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']

let weatherCache = null // { data, expiresAt }

class UpstreamError extends Error {}

// 매시 정각 자료가 40분쯤 뒤에 나오므로 40분 전이면 한 시간 전 자료를 요청한다.
// 서버 시간대와 상관없이 KST 기준으로 계산한다.
function kmaBaseTime(now = Date.now()) {
  const kst = new Date(now + 9 * 3600_000 - 40 * 60_000)
  return {
    baseDate: kst.toISOString().slice(0, 10).replaceAll('-', ''),
    baseTime: `${String(kst.getUTCHours()).padStart(2, '0')}00`,
  }
}

async function fetchWeather() {
  const { baseDate, baseTime } = kmaBaseTime()
  const query = new URLSearchParams({
    serviceKey: process.env.KMA_API_KEY.trim(),
    pageNo: '1',
    numOfRows: '20',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(CHEONAN.nx),
    ny: String(CHEONAN.ny),
  })

  let body
  try {
    const res = await fetch(`${KMA_URL}?${query}`, { signal: AbortSignal.timeout(5000) })
    // 인증 오류 등은 dataType=JSON이어도 XML로 오므로 JSON 파싱 실패도 오류로 본다
    body = JSON.parse(await res.text())
  } catch (err) {
    throw new UpstreamError(`기상청 응답을 받지 못했습니다. (${err.name})`)
  }

  const header = body?.response?.header
  if (header?.resultCode !== '00') {
    throw new UpstreamError(`기상청 오류: ${header?.resultMsg ?? '알 수 없는 응답'}`)
  }

  const values = {}
  for (const item of body.response.body?.items?.item ?? []) values[item.category] = item.obsrValue
  const num = (v) => (v === undefined || Number.isNaN(Number(v)) ? null : Number(v))
  const vec = num(values.VEC)

  return {
    location: CHEONAN.name,
    observedAt: `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6)}T${baseTime.slice(0, 2)}:00:00+09:00`,
    temperature: num(values.T1H),
    humidity: num(values.REH),
    rain1h: num(values.RN1) ?? 0,
    precipType: PTY_TEXT[values.PTY] ?? '알 수 없음',
    windSpeed: num(values.WSD),
    windDir: vec === null ? null : WIND_DIRS[Math.round(vec / 45) % 8],
  }
}

// 날씨 라우트와 브리핑이 함께 쓴다. 기상청 호출 한도를 아끼려고 10분 동안 메모리에 캐시한다
async function getWeather() {
  if (weatherCache && weatherCache.expiresAt > Date.now()) return weatherCache.data
  const data = await fetchWeather()
  weatherCache = { data, expiresAt: Date.now() + WEATHER_TTL }
  return data
}

// 네이버 뉴스 검색 (최신순 3건)
const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json'
const MAX_QUERY = 50
const HTML_ENTITIES = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }

// 검색어 강조용 <b> 태그를 지우고 엔티티(&quot; 등)를 글자로 바꾼다
function cleanTitle(title) {
  return title.replace(/<\/?b>/gi, '').replace(/&(quot|amp|lt|gt|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m])
}

async function fetchNews(query) {
  let res
  let body
  try {
    res = await fetch(`${NAVER_NEWS_URL}?${new URLSearchParams({ query, display: '3', sort: 'date' })}`, {
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID.trim(),
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET.trim(),
      },
      signal: AbortSignal.timeout(5000),
    })
    body = await res.json()
  } catch (err) {
    throw new UpstreamError(`네이버 응답을 받지 못했습니다. (${err.name})`)
  }
  if (!res.ok || !Array.isArray(body?.items)) {
    throw new UpstreamError(`네이버 오류 (${res.status}): ${body?.errorMessage ?? '알 수 없는 응답'}`)
  }

  return body.items.map((item) => {
    const date = new Date(item.pubDate)
    return {
      title: cleanTitle(item.title),
      link: item.link,
      date: Number.isNaN(date.getTime()) ? null : date.toISOString(),
    }
  })
}

// Finnhub 시세. 무료 한도(분당 60회)를 넘지 않게 종목별로 1분 동안 캐시한다
const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote'
const DEFAULT_SYMBOLS = ['MSFT', 'AAPL', 'NVDA', 'GOOGL']
// 프런트(StockCard)와 같은 규칙
const MAX_SYMBOLS = 6
const SYMBOL_PATTERN = /^[A-Z0-9.:-]{1,15}$/
const STOCK_TTL = 60 * 1000

const stockCache = new Map() // symbol → { data, expiresAt }

// 없는 종목은 200에 값이 모두 0(d, dp는 null)으로 오고,
// 무료 플랜에서 볼 수 없는 종목(해외 거래소 등)은 403으로 온다. 둘 다 found: false로 본다.
async function fetchQuote(symbol) {
  let res
  let body
  try {
    res = await fetch(`${FINNHUB_QUOTE_URL}?${new URLSearchParams({ symbol, token: process.env.FINNHUB_API_KEY.trim() })}`, {
      signal: AbortSignal.timeout(5000),
    })
    body = await res.json()
  } catch (err) {
    throw new UpstreamError(`Finnhub 응답을 받지 못했습니다. (${symbol}, ${err.name})`)
  }

  const notFound = { symbol, price: null, changePct: null, found: false }
  if (res.status === 403) return notFound
  if (!res.ok || typeof body !== 'object' || body === null) {
    throw new UpstreamError(`Finnhub 오류 (${symbol}, ${res.status}): ${body?.error ?? '알 수 없는 응답'}`)
  }
  if (['c', 'd', 'dp', 'h', 'l', 'o', 'pc'].every((key) => !body[key])) return notFound
  return { symbol, price: body.c, changePct: body.dp ?? 0, found: true }
}

async function getQuote(symbol) {
  const cached = stockCache.get(symbol)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  try {
    const data = await fetchQuote(symbol)
    // 지난 항목을 정리해 Map이 계속 커지지 않게 한다
    for (const [key, entry] of stockCache) if (entry.expiresAt <= Date.now()) stockCache.delete(key)
    stockCache.set(symbol, { data, expiresAt: Date.now() + STOCK_TTL })
    return data
  } catch (err) {
    if (!(err instanceof UpstreamError)) throw err
    console.error(err.message)
    // 실패한 종목은 저장하지 않고, 이 종목만 error로 표시한다
    return { symbol, price: null, changePct: null, found: null, error: '시세를 가져오지 못했습니다.' }
  }
}

// AI 기획안 (OpenRouter). 항목 순서와 이름은 프런트(src/proposal.js)와 같게 둔다
const OPENROUTER_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'openrouter/free'
const MODELS_TTL = 60 * 60 * 1000
const MODEL_KINDS = ['text', 'vision', 'image', 'speech', 'transcription', 'video']
const PROPOSAL_FIELDS = {
  title: { label: '제목', max: 80 },
  summary: { label: '한 줄 요약', max: 200 },
  problem: { label: '지금의 문제', max: 1000 },
  approach: { label: 'AI 활용 방식', max: 1000 },
  effect: { label: '효과', max: 1000 },
}
const DIFFICULTIES = ['쉬움', '보통', '어려움']

// 사진 설명·이미지 그리기·읽어 주기·받아쓰기 기본 모델. 프런트(src/aiSettings.js)와 같게 둔다
const DEFAULT_VISION_MODEL = 'minimax/minimax-m3.1-flash:free'
const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image'
const DEFAULT_SPEECH_MODEL = 'elevenlabs/eleven-v4-turbo'
// ElevenLabs 기본 목소리에는 한국어 전용이 없다. 한국어 문장을 읽혀 받아쓰기로 되돌렸을 때 원문과 같게 나온 목소리
const DEFAULT_SPEECH_VOICE = 'sarah'
const DEFAULT_TRANSCRIPTION_MODEL = 'openai/whisper-large-v3-turbo'
// 1회 예상 토큰. 이미지 가격 단위가 모델마다 달라(장당·이미지 토큰당) 1024px 한 장을 1290토큰으로 어림한다
const DESCRIBE_INPUT_TOKENS = 1500
const DESCRIBE_OUTPUT_TOKENS = 300
const DRAW_PROMPT_TOKENS = 150
const DRAW_IMAGE_TOKENS = 1290
// 읽어 주기는 글자당 가격(Gemini TTS 등은 오디오 출력 토큰 가격이 더 붙는다), 받아쓰기는 초당 가격이다
// 1회 예상: 300글자 읽기(오디오 약 60초 = 1500토큰), 30초 받아쓰기
const SPEAK_CHARS = 300
const SPEAK_AUDIO_TOKENS = 1500
const LISTEN_SECONDS = 30
// 초당 가격 대신 토큰 가격이 붙은 받아쓰기 모델(gpt-4o-transcribe 등)은 오디오 1초 = 32토큰, 글 3토큰으로 어림한다
const LISTEN_AUDIO_TOKENS_PER_SECOND = 32
const LISTEN_TEXT_TOKENS_PER_SECOND = 3
// "가장 많이 씀" 표시용. OpenRouter에 공개 API가 없어 순위 페이지에 들어 있는 사용량 데이터를 읽는다(비공식)
const RANKING_URLS = {
  vision: 'https://openrouter.ai/rankings',
  image: 'https://openrouter.ai/rankings/image',
  speech: 'https://openrouter.ai/rankings/speech',
  transcription: 'https://openrouter.ai/rankings/transcription',
  video: 'https://openrouter.ai/rankings/video',
}
const RANKING_RETRY = 10 * 60 * 1000

let catalogCache = null // { data, expiresAt } OpenRouter 모델 원본 목록
const rankingCache = {} // { [kind]: { counts, expiresAt } }

function validateProposal(input) {
  if (typeof input !== 'object' || input === null) return { error: '기획안 형식이 올바르지 않습니다.' }
  const value = {}
  for (const [key, { label, max }] of Object.entries(PROPOSAL_FIELDS)) {
    const text = typeof input[key] === 'string' ? input[key].trim() : ''
    if (!text) return { error: `기획안의 ${label} 항목이 비어 있습니다.` }
    if (text.length > max) return { error: `기획안의 ${label} 항목이 너무 깁니다.` }
    value[key] = text
  }
  const difficulty = typeof input.difficulty === 'string' ? input.difficulty.trim() : ''
  if (!DIFFICULTIES.includes(difficulty)) return { error: '난이도는 쉬움·보통·어려움 중 하나여야 합니다.' }
  value.difficulty = difficulty
  return { value }
}

async function fetchModelList(path) {
  let body
  try {
    const res = await fetch(`${OPENROUTER_URL}${path}`, { signal: AbortSignal.timeout(10000) })
    body = await res.json()
    if (!res.ok || !Array.isArray(body?.data)) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    throw new UpstreamError(`OpenRouter 모델 목록을 받지 못했습니다. (${err.message})`)
  }
  return body.data
}

// 기본 목록에는 이미지만 내는 모델(flux 등)·음성 모델이 빠져 있어 모든 출력 종류를 받는다
async function getCatalog() {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.data
  const data = await fetchModelList('/models?output_modalities=all')
  catalogCache = { data, expiresAt: Date.now() + MODELS_TTL }
  return data
}

// 순위 페이지 안의 { model_permaslug, variant, count } 묶음을 모델별 요청 수로 더한다
async function fetchRanking(kind) {
  const res = await fetch(RANKING_URLS[kind], {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = (await res.text()).replaceAll('\\"', '"')
  const counts = new Map()
  for (const [, slug, variant, count] of text.matchAll(/"model_permaslug":"([^"]+)","variant":"([^"]+)"[^{}]*?"count":(\d+)/g)) {
    const key = `${slug}|${variant}`
    counts.set(key, (counts.get(key) ?? 0) + Number(count))
  }
  if (counts.size === 0) throw new Error('사용량 데이터를 찾지 못함')
  return counts
}

// 실패해도 배지만 빠지고 목록은 보여 준다. 실패하면 10분 뒤에 다시 시도한다
async function getRanking(kind) {
  const cached = rankingCache[kind]
  if (cached && cached.expiresAt > Date.now()) return cached.counts
  let counts
  try {
    counts = await fetchRanking(kind)
    rankingCache[kind] = { counts, expiresAt: Date.now() + MODELS_TTL }
  } catch (err) {
    console.error(`OpenRouter 순위를 읽지 못했습니다. (${kind}, ${err.message})`)
    counts = new Map()
    rankingCache[kind] = { counts, expiresAt: Date.now() + RANKING_RETRY }
  }
  return counts
}

// 가격은 토큰당 USD 문자열로 온다. 화면에서 읽기 쉽게 100만 토큰당 USD로 바꾼다
// kind: text(다듬기) · vision(사진 설명, 이미지 입력 → 글) · image(이미지 그리기, 이미지 출력)
async function getModels(kind = 'text') {
  if (kind === 'video') return getVideoModels()
  if (kind !== 'text') return getMediaModels(kind)
  const catalog = await getCatalog()
  return catalog
    .filter((m) => m.architecture?.output_modalities?.includes('text'))
    .map((m) => {
      const input = Number(m.pricing?.prompt)
      const output = Number(m.pricing?.completion)
      return {
        id: m.id,
        name: m.name,
        free: input === 0 && output === 0,
        inputPrice: input * 1_000_000,
        outputPrice: output * 1_000_000,
        contextLength: m.context_length ?? null,
      }
    })
    // 가격이 정해지지 않은 라우터(-1 등)는 비용을 미리 알 수 없으므로 뺀다
    .filter((m) => m.inputPrice >= 0 && m.outputPrice >= 0)
    .sort((a, b) => (a.id === DEFAULT_MODEL ? -1 : b.id === DEFAULT_MODEL ? 1 : b.free - a.free || a.name.localeCompare(b.name)))
}

// 받아쓰기 초당 가격(USD). 토큰 가격 모델은 어림값
function secondPrice(input, output) {
  return output > 0 ? LISTEN_AUDIO_TOKENS_PER_SECOND * input + LISTEN_TEXT_TOKENS_PER_SECOND * output : input
}

// 종류별 걸러 내기와 1회 예상 비용(USD). price(key)는 pricing의 토큰(글자·초)당 USD
const MEDIA_KINDS = {
  // 사진 설명은 글만 내는 모델로 한정한다 (음악·이미지를 함께 내는 모델 제외)
  vision: {
    defaultId: DEFAULT_VISION_MODEL,
    match: (inputs, outputs) => inputs.includes('image') && outputs.length > 0 && outputs.every((o) => o === 'text'),
    estimate: (price) => DESCRIBE_INPUT_TOKENS * price('prompt') + DESCRIBE_OUTPUT_TOKENS * price('completion'),
  },
  image: {
    defaultId: DEFAULT_IMAGE_MODEL,
    match: (inputs, outputs) => outputs.includes('image'),
    estimate: (price) => DRAW_PROMPT_TOKENS * price('prompt') + DRAW_IMAGE_TOKENS * price('image_output'),
  },
  speech: {
    defaultId: DEFAULT_SPEECH_MODEL,
    match: (inputs, outputs) => outputs.includes('speech'),
    estimate: (price) => SPEAK_CHARS * price('prompt') + SPEAK_AUDIO_TOKENS * price('completion'),
  },
  transcription: {
    defaultId: DEFAULT_TRANSCRIPTION_MODEL,
    match: (inputs, outputs) => outputs.includes('transcription'),
    estimate: (price) => LISTEN_SECONDS * secondPrice(price('prompt'), price('completion')),
  },
}

// 미디어 모델. 1회 예상 비용(estimate, USD)과 기본(default)·가장 저렴(cheapest)·가장 많이 씀(popular)을 함께 준다
// 읽어 주기는 목소리 목록(voices)과 기본 목소리(defaultVoice), 받아쓰기는 초당 가격(secondPrice)을 더 준다
async function getMediaModels(kind) {
  const config = MEDIA_KINDS[kind]
  const [catalog, ranking] = await Promise.all([getCatalog(), getRanking(kind)])
  const data = catalog
    .filter((m) => config.match(m.architecture?.input_modalities ?? [], m.architecture?.output_modalities ?? []))
    .map((m) => {
      const price = (key) => Number(m.pricing?.[key] ?? 0)
      const input = price('prompt')
      const output = price('completion')
      // 순위의 모델 이름은 canonical_slug와 같고, 무료판은 variant가 free로 따로 잡힌다
      const variant = m.id.endsWith(':free') ? 'free' : 'standard'
      const model = {
        id: m.id,
        name: m.name,
        // 이미지 모델은 글 가격이 0이어도 이미지 가격이 붙으므로 모든 가격이 0일 때만 무료
        free: Object.values(m.pricing ?? {}).every((v) => Number(v) === 0),
        inputPrice: input * 1_000_000,
        outputPrice: output * 1_000_000,
        estimate: config.estimate(price),
        default: m.id === config.defaultId,
        usage: ranking.get(`${m.canonical_slug}|${variant}`) ?? 0,
        outputs: m.architecture.output_modalities,
        valid: input >= 0 && output >= 0 && price('image_output') >= 0,
      }
      if (kind === 'speech') {
        model.voices = Array.isArray(m.supported_voices) ? m.supported_voices : []
        // ElevenLabs 계열은 같은 목소리 이름을 쓰므로 기본 목소리가 있으면 그것, 없으면 목록의 첫 번째
        model.defaultVoice = model.voices.includes(DEFAULT_SPEECH_VOICE) ? DEFAULT_SPEECH_VOICE : (model.voices[0] ?? null)
      }
      if (kind === 'transcription') model.secondPrice = secondPrice(input, output)
      return model
    })
    .filter((m) => m.valid)

  // 값이 같으면 기본 모델을 고른다
  const cheapest = data.filter((m) => !m.free && m.estimate > 0).sort((a, b) => a.estimate - b.estimate || b.default - a.default)[0]
  const popular = data.filter((m) => m.usage > 0).sort((a, b) => b.usage - a.usage)[0]
  // 기본 → 가장 많이 씀 → 가장 저렴 → 무료 → 이름순
  const rank = (m) => (m.default ? 0 : m.popular ? 1 : m.cheapest ? 2 : m.free ? 3 : 4)
  return data
    .map(({ valid, usage, ...rest }) => ({ ...rest, cheapest: rest.id === cheapest?.id, popular: rest.id === popular?.id }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

const REFINE_PROMPT = `너는 사내 AI 활용(AX) 아이디어를 짧은 기획안으로 다듬는 기획자다.
사용자가 준 아이디어를 바탕으로 아래 키를 가진 JSON 객체 하나만 출력한다. 설명, 코드 블록 표시는 쓰지 않는다.
- title: 다듬은 제목 (40자 이내)
- summary: 한 줄 요약 (100자 이내)
- problem: 지금의 문제 (2~3문장)
- approach: AI 활용 방식 (2~3문장, 구체적인 방법)
- effect: 기대 효과 (2~3문장, 가능하면 수치 예시)
- difficulty: 도입 난이도. "쉬움", "보통", "어려움" 중 하나
모든 값은 한국어로만 쓰고 한자나 다른 언어를 섞지 않는다. 원래 아이디어에 없는 사실을 단정하지 않는다.`

// 모델이 코드 블록이나 앞뒤 설명을 붙여도 JSON 부분만 꺼낸다
function parseProposal(content) {
  const text = typeof content === 'string' ? content : ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { error: '기획안을 JSON으로 받지 못했습니다.' }
  try {
    return validateProposal(JSON.parse(text.slice(start, end + 1)))
  } catch {
    return { error: '기획안 JSON을 읽지 못했습니다.' }
  }
}

async function refineIdea(idea, model) {
  const messages = [
    { role: 'system', content: REFINE_PROMPT },
    { role: 'user', content: `제목: ${idea.title}\n대상 업무: ${idea.target}\nAI 활용 아이디어: ${idea.idea}` },
  ]
  let lastError = ''
  let cost = 0
  // 무료 라우터는 매번 다른 모델로 연결되어 형식이 틀릴 수 있어 한 번 더 시도한다
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = await callOpenRouter({ model, messages }, 60000)
    cost += Number(body.usage?.cost) || 0
    const { value, error } = parseProposal(body.choices?.[0]?.message?.content)
    if (value) return { proposal: value, model: body.model ?? model, cost }
    lastError = `${error} (${body.model ?? model})`
  }
  throw new UpstreamError(lastError)
}

// 대표 이미지. 프런트(src/image.js)와 같은 규칙: jpeg·png·webp, 저장은 1.5MB 이하, 설명은 200자 이하
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_BYTES = 1_500_000
const MAX_CAPTION = 200
const IMAGE_BODY_LIMIT = 2_500_000

// data URL을 { mime, data(Buffer) }로 바꾼다
function parseDataUrl(input) {
  const match = typeof input === 'string' ? input.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/) : null
  if (!match || !IMAGE_TYPES.includes(match[1])) return { error: '이미지는 JPG, PNG, WebP만 올릴 수 있습니다.' }
  const data = Buffer.from(match[2], 'base64')
  if (data.length === 0) return { error: '이미지가 비어 있습니다.' }
  if (data.length > MAX_IMAGE_BYTES) return { error: '이미지가 너무 큽니다.' }
  return { value: { mime: match[1], data } }
}

function callOpenRouter(payload, timeout) {
  return callOpenRouterPath('/chat/completions', { ...payload, usage: { include: true } }, timeout)
}

async function callOpenRouterPath(path, payload, timeout) {
  let res
  let body
  try {
    res = await fetch(`${OPENROUTER_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    })
    body = await res.json()
  } catch (err) {
    throw new UpstreamError(`OpenRouter 응답을 받지 못했습니다. (${err.name})`)
  }
  if (!res.ok || body?.error) {
    throw new UpstreamError(`OpenRouter 오류 (${res.status}): ${body?.error?.message ?? '알 수 없는 응답'}`)
  }
  return body
}

const DESCRIBE_PROMPT = `사진에 보이는 내용을 한국어 한 문장으로 설명한다.
사진에 보이는 것만 쓰고 추측하지 않는다. 100자 안팎으로 쓰고, 문장 하나만 출력한다. 따옴표나 다른 설명은 붙이지 않는다.`

// 모델이 따옴표·줄바꿈을 붙여도 첫 줄만 깔끔하게 꺼낸다
function parseCaption(content) {
  const line = (typeof content === 'string' ? content : '').trim().split('\n')[0].trim()
  const text = line.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (!text) return { error: '설명을 받지 못했습니다.' }
  if (text.length > MAX_CAPTION) return { error: '설명이 너무 깁니다.' }
  return { value: text }
}

async function describePhoto(image, model) {
  const messages = [
    { role: 'system', content: DESCRIBE_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '이 사진을 한 문장으로 설명해 줘.' },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ]
  let lastError = ''
  let cost = 0
  // 다듬기와 같이 형식이 틀리면 한 번 더 시도한다
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = await callOpenRouter({ model, messages }, 60000)
    cost += Number(body.usage?.cost) || 0
    const { value, error } = parseCaption(body.choices?.[0]?.message?.content)
    if (value) return { caption: value, model: body.model ?? model, cost }
    lastError = `${error} (${body.model ?? model})`
  }
  throw new UpstreamError(lastError)
}

// 비용이 드는 호출이라 다시 시도하지 않는다. 이미지만 내는 모델은 modalities에 text를 넣으면 거절한다
async function drawImage(idea, model) {
  const title = idea.proposal?.title ?? idea.title
  const prompt = `Create a representative illustration for an idea card.
Card title (Korean): "${title}"
Work area (Korean): "${idea.target}"
Show the idea visually in a clean, modern flat illustration style with a simple background.
Square composition. Do not include any text, letters, numbers, or logos in the image.`
  const body = await callOpenRouter(
    {
      model: model.id,
      messages: [{ role: 'user', content: prompt }],
      modalities: model.outputs.includes('text') ? ['image', 'text'] : ['image'],
    },
    120000,
  )
  const cost = Number(body.usage?.cost) || 0
  let url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (typeof url !== 'string') throw new UpstreamError(`이미지를 받지 못했습니다. (${body.model ?? model.id})`)

  // 주소로 오는 경우에는 받아서 data URL로 바꾼다
  if (/^https?:\/\//.test(url)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/png'
      url = `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
    } catch (err) {
      throw new UpstreamError(`생성된 이미지를 내려받지 못했습니다. (${err.message})`)
    }
  }
  if (!url.startsWith('data:image/')) throw new UpstreamError(`이미지 형식이 올바르지 않습니다. (${body.model ?? model.id})`)
  return { image: url, model: body.model ?? model.id, cost }
}

// 읽어 주기·받아쓰기. 프런트(src/audio.js)와 같은 규칙: 녹음은 60초·3MB 이하, 형식은 아래 목록
const MAX_SPEAK_CHARS = 500
const AUDIO_FORMATS = ['webm', 'ogg', 'm4a', 'mp3', 'wav']
const MAX_AUDIO_BYTES = 3_000_000
const AUDIO_BODY_LIMIT = 4_500_000

// 카드에서 읽을 글: 제목과 (기획안이 있으면) 한 줄 요약, 없으면 아이디어. 비용 때문에 500자에서 자른다
function speechText(idea) {
  const text = idea.proposal
    ? `${idea.proposal.title}. ${idea.proposal.summary}`
    : `${idea.title}. ${idea.idea}`
  return text.length > MAX_SPEAK_CHARS ? text.slice(0, MAX_SPEAK_CHARS) : text
}

// 응답은 음성 파일(mp3)이다. 비용은 응답에 없어서 글자 수로 계산한다(오디오 토큰 가격이 붙는 모델은 어림값)
async function speakText(text, model, voice) {
  let res
  try {
    res = await fetch(`${OPENROUTER_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: model.id, input: text, ...(voice && { voice }), response_format: 'mp3' }),
      signal: AbortSignal.timeout(60000),
    })
  } catch (err) {
    throw new UpstreamError(`OpenRouter 응답을 받지 못했습니다. (${err.name})`)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new UpstreamError(`OpenRouter 오류 (${res.status}): ${body?.error?.message ?? '알 수 없는 응답'}`)
  }
  let audio
  try {
    audio = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    throw new UpstreamError(`음성을 받지 못했습니다. (${err.name})`)
  }
  if (audio.length === 0) throw new UpstreamError(`음성이 비어 있습니다. (${model.id})`)
  const audioTokens = SPEAK_AUDIO_TOKENS * (text.length / SPEAK_CHARS)
  const cost = (text.length * model.inputPrice + audioTokens * model.outputPrice) / 1_000_000
  return { audio, mime: res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg', cost }
}

// 출근길 브리핑: 날씨·뉴스·주가를 동시에 모아 글로 쓰고 음성으로 만든다
// 뉴스 검색어는 뉴스 카드 기본값과 같다
const BRIEFING_NEWS_QUERY = '천안 AX'
const MAX_BRIEFING_SENTENCES = 4

// 키가 없으면 그 정보만 빠지도록 UpstreamError로 던진다
function requireKeys(...names) {
  const missing = names.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) throw new UpstreamError(`${missing.join(', ')}가 없습니다.`)
}

// 셋을 동시에 부르고, 실패한 것은 null(정보 없음)로 둔다
async function gatherBriefing(symbols, query) {
  const [weather, news, stocks] = await Promise.allSettled([
    (async () => {
      requireKeys('KMA_API_KEY')
      return getWeather()
    })(),
    (async () => {
      requireKeys('NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET')
      const items = await fetchNews(query)
      if (items.length === 0) throw new UpstreamError(`"${query}" 뉴스가 없습니다.`)
      return items
    })(),
    (async () => {
      requireKeys('FINNHUB_API_KEY')
      // getQuote는 종목별로 실패를 error로 돌려주므로, 찾은 종목만 쓴다
      const quotes = (await Promise.all(symbols.map(getQuote))).filter((q) => q.found)
      if (quotes.length === 0) throw new UpstreamError('브리핑에 쓸 시세가 없습니다.')
      return quotes
    })(),
  ])
  const pick = (result, label) => {
    if (result.status === 'fulfilled') return result.value
    if (!(result.reason instanceof UpstreamError)) throw result.reason
    console.error(`브리핑 ${label}: ${result.reason.message}`)
    return null
  }
  return { weather: pick(weather, '날씨'), news: pick(news, '뉴스'), stocks: pick(stocks, '주가') }
}

function briefingFacts({ weather, news, stocks }, query) {
  const sign = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  const weatherLine = weather
    ? `날씨(${weather.location}, ${weather.observedAt.slice(11, 13)}시 관측): 기온 ${weather.temperature ?? '-'}도, ${weather.precipType}, ` +
      `습도 ${weather.humidity ?? '-'}%, 바람 ${weather.windDir ?? ''} ${weather.windSpeed ?? '-'}m/s, 1시간 강수량 ${weather.rain1h}mm`
    : '날씨: 정보 없음'
  const newsLines = news ? [`뉴스("${query}" 최신순):`, ...news.map((n) => `- ${n.title}`)] : ['뉴스: 정보 없음']
  const stockLines = stocks
    ? ['주가(미국 주식, 가격 단위 달러, 전일 종가 대비):', ...stocks.map((s) => `- ${s.symbol} $${s.price.toFixed(2)} (${sign(s.changePct)})`)]
    : ['주가: 정보 없음']
  return [weatherLine, ...newsLines, ...stockLines].join('\n')
}

const BRIEFING_PROMPT = `너는 회사 사람들에게 출근길 브리핑을 읽어 주는 진행자다.
주어진 정보만 써서 한국어 한 단락, ${MAX_BRIEFING_SENTENCES}문장 이내로 브리핑을 쓴다.
- 날씨, 뉴스, 주가 순서로 핵심만 짚는다. 주가는 오르고 내린 흐름 위주로 짧게 말하고, 가격을 말할 때는 단위(달러)를 바꾸지 않는다.
- "정보 없음"인 항목은 지어내지 말고 "OO 정보 없음"이라고 짧게 밝힌다.
- 소리 내어 읽을 글이므로 목록, 기호, 이모지, 마크다운, 따옴표를 쓰지 않는다.
- 한국어로만 쓰고 한자나 다른 언어를 섞지 않는다(종목 기호는 그대로 둔다).
브리핑 글만 출력한다.`

// 줄을 한 단락으로 합치고 앞 4문장만 남긴다. 소수점(1.32)은 뒤에 공백이 없어 문장으로 나뉘지 않는다
function parseBriefing(content) {
  const paragraph = (typeof content === 'string' ? content : '')
    .replace(/[*#`>]/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-•]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
  if (!paragraph) return { error: '브리핑 글을 받지 못했습니다.' }
  const text = paragraph.split(/(?<=[.!?])\s+/).slice(0, MAX_BRIEFING_SENTENCES).join(' ')
  // 읽어 주기와 같은 한도. 넘으면 다시 쓰게 한다
  if (text.length > MAX_SPEAK_CHARS) return { error: '브리핑 글이 너무 깁니다.' }
  return { value: text }
}

async function writeBriefing(facts, model) {
  const messages = [
    { role: 'system', content: BRIEFING_PROMPT },
    { role: 'user', content: `오늘 정보:\n${facts}` },
  ]
  let lastError = ''
  let cost = 0
  // 무료 라우터는 매번 다른 모델로 연결되어 응답이 늦거나 형식이 틀릴 수 있다.
  // 시간 초과·오류·형식 오류 모두 한 번 더 시도하고, 시도마다 45초를 넘기지 않는다
  for (let attempt = 0; attempt < 2; attempt++) {
    let body
    try {
      body = await callOpenRouter({ model, messages }, 45000)
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      lastError = err.message
      console.error(`브리핑 글 (${attempt + 1}번째): ${err.message}`)
      continue
    }
    cost += Number(body.usage?.cost) || 0
    const { value, error } = parseBriefing(body.choices?.[0]?.message?.content)
    if (value) return { text: value, model: body.model ?? model, cost }
    lastError = `${error} (${body.model ?? model})`
  }
  throw new UpstreamError(lastError)
}

// 읽어 주기 모델·목소리는 목록에 있는 것만 받는다. 목소리 목록이 없는 모델은 목소리를 보내지 않는다
async function resolveSpeech(modelId, voiceInput) {
  const model = (await getModels('speech')).find((m) => m.id === modelId)
  if (!model) return { error: '사용할 수 없는 모델입니다.' }
  if (model.voices.length === 0) return { model, voice: null }
  const voice = typeof voiceInput === 'string' && voiceInput ? voiceInput : model.defaultVoice
  if (!model.voices.includes(voice)) return { error: '이 모델에서 쓸 수 없는 목소리입니다.' }
  return { model, voice }
}

async function transcribeAudio(data, format, model) {
  const body = await callOpenRouterPath('/audio/transcriptions', { model, input_audio: { data, format }, language: 'ko' }, 60000)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) throw new UpstreamError(`받아쓴 내용이 없습니다. (${model})`)
  return { text, model, seconds: Number(body.usage?.seconds) || null, cost: Number(body.usage?.cost) || 0 }
}

// 활용 장면 영상. 기본 모델은 프런트(src/aiSettings.js)와 같게 둔다
const DEFAULT_VIDEO_MODEL = 'google/veo-3.1-lite'
const VIDEO_MIN_SECONDS = 5
const VIDEO_MAX_SECONDS = 8
const VIDEO_ASPECT_RATIO = '16:9'
// 영상 토큰 가격 모델(Seedance 등)의 토큰 수: 가로 × 세로 × 24fps × 초 / 1024
const VIDEO_FPS = 24
const VIDEO_SIZES = { '480p': [854, 480], '720p': [1280, 720], '768p': [1366, 768], '1080p': [1920, 1080], '2K': [2560, 1440], '4K': [3840, 2160] }
const VIDEO_POLL_INTERVAL = 20 * 1000
const VIDEO_TIMEOUT = 20 * 60 * 1000 // 이보다 오래 걸리면 실패로 둔다
const MAX_SCENE = 300
const MAX_VIDEO_PROMPT = 2000

let videoModelsCache = null // { data, expiresAt } /videos/models 원본

// 가격 키 이름이 모델마다 다르다(USD/초 duration_seconds_*, 센트/초 cents_*, 영상 토큰 video_tokens_*).
// 고른 해상도·소리 여부에 가장 맞는 키를 골라 초당 USD로 바꾼다. 맞는 키가 없으면 null
function videoSecondPrice(skus, resolution, audio) {
  const resolutions = Object.keys(VIDEO_SIZES).map((r) => r.toLowerCase())
  let best = null
  for (const [key, raw] of Object.entries(skus ?? {})) {
    const value = Number(raw)
    const k = key.toLowerCase()
    if (!Number.isFinite(value)) continue
    // 첫 장면 이미지로 만드는 경우만 본다 (참조·이어 만들기·업스케일·영상 입력·글로만 만들기 가격 제외)
    if (/reference|continuation|megapixel|minimum|input|text_to_video/.test(k)) continue
    const keyResolution = resolutions.find((r) => k.endsWith(`_${r}`) || k.includes(`_${r}_`))
    if (keyResolution && keyResolution !== resolution.toLowerCase()) continue

    let perSecond
    if (k.includes('video_tokens')) {
      const [w, h] = VIDEO_SIZES[resolution] ?? VIDEO_SIZES['720p']
      perSecond = ((w * h * VIDEO_FPS) / 1024) * value
    } else if (k.startsWith('cents_')) {
      if (!k.includes('second')) continue
      perSecond = value / 100
    } else if (k.includes('duration_seconds')) {
      perSecond = value
    } else {
      continue
    }

    // 점수가 낮을수록 잘 맞는다: 해상도가 정확히 맞으면 우선, 소리 여부가 맞으면 우선, image_to_video 우선
    const withAudio = k.includes('with_audio')
    const withoutAudio = k.includes('without_audio')
    let score = keyResolution ? 0 : 1
    if (audio) score += withoutAudio ? 10 : withAudio ? 0 : 1
    else score += withAudio ? 10 : withoutAudio ? 0 : 1
    if (!k.includes('image_to_video')) score += 0.5
    if (!best || score < best.score) best = { score, perSecond }
  }
  return best && best.score < 10 ? best.perSecond : null
}

// 영상 모델: 첫 장면 이미지를 받고 5~8초 길이를 지원하는 모델만. 가격은 720p(없으면 지원하는 첫 해상도) 기준
async function getVideoModels() {
  let raw
  if (videoModelsCache && videoModelsCache.expiresAt > Date.now()) {
    raw = videoModelsCache.data
  } else {
    raw = await fetchModelList('/videos/models')
    videoModelsCache = { data: raw, expiresAt: Date.now() + MODELS_TTL }
  }
  const ranking = await getRanking('video')
  const data = raw
    .filter((m) => m.supported_frame_images?.includes('first_frame'))
    .map((m) => {
      const durations = (m.supported_durations ?? [])
        .filter((d) => d >= VIDEO_MIN_SECONDS && d <= VIDEO_MAX_SECONDS)
        .sort((a, b) => a - b)
      const resolutions = m.supported_resolutions ?? []
      const resolution = resolutions.includes('720p') ? '720p' : (resolutions[0] ?? '720p')
      const audio = m.generate_audio === true
      const silent = videoSecondPrice(m.pricing_skus, resolution, false)
      const withAudio = audio ? videoSecondPrice(m.pricing_skus, resolution, true) : null
      const duration = durations.at(-1)
      const perSecond = withAudio ?? silent
      return {
        id: m.id,
        name: m.name,
        free: false,
        durations,
        resolution,
        audio,
        // 초당 USD. 소리를 만들 수 없는 모델은 audio가 null
        pricePerSecond: { audio: withAudio, silent },
        // 가장 긴 길이, 소리 포함(가능하면) 기준 1회 예상 비용
        estimate: perSecond === null ? null : perSecond * duration,
        default: m.id === DEFAULT_VIDEO_MODEL,
        usage: ranking.get(`${m.canonical_slug}|standard`) ?? 0,
      }
    })
    // 길이가 맞지 않거나 가격을 계산할 수 없는 모델은 비용을 미리 알 수 없어 뺀다
    .filter((m) => m.durations.length > 0 && m.estimate !== null)

  const cheapest = data.slice().sort((a, b) => a.estimate - b.estimate || b.default - a.default)[0]
  const popular = data.filter((m) => m.usage > 0).sort((a, b) => b.usage - a.usage)[0]
  const rank = (m) => (m.default ? 0 : m.popular ? 1 : m.cheapest ? 2 : 4)
  return data
    .map(({ usage, ...rest }) => ({ ...rest, cheapest: rest.id === cheapest?.id, popular: rest.id === popular?.id }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function videoCost(model, duration, audio) {
  const perSecond = audio ? model.pricePerSecond.audio : model.pricePerSecond.silent
  return (perSecond ?? model.pricePerSecond.silent ?? model.pricePerSecond.audio) * duration
}

const VIDEO_PLAN_PROMPT = `너는 사내 AI 활용(AX) 아이디어를 짧은 영상으로 보여 주는 영상 기획자다.
카드의 "대상 업무"를 AI 도입 전 장면으로, "AI 활용 아이디어"를 도입 후 장면으로 해서 한 편의 짧은 영상을 기획한다.
영상의 첫 장면은 카드 대표 이미지로 정해져 있다. 아래 키를 가진 JSON 객체 하나만 출력한다. 설명, 코드 블록 표시는 쓰지 않는다.
- before: 도입 전 장면 설명 (한국어, 2문장 이내)
- after: 도입 후 장면 설명 (한국어, 2문장 이내)
- duration: 영상 길이(초). 사용자가 준 선택지 중 하나
- prompt: 영상 생성 모델에 넣을 영어 프롬프트. 첫 장면 이미지에서 시작해 도입 전 → 도입 후로 자연스럽게 바뀌는 한 장면 흐름, 카메라 움직임, 분위기를 구체적으로 쓴다. 화면에 글자·자막·로고는 넣지 않는다. 600자 이내
원래 아이디어에 없는 사실을 단정하지 않는다.`

function validateScenario(input, durations) {
  if (typeof input !== 'object' || input === null) return { error: '시나리오 형식이 올바르지 않습니다.' }
  const text = (key) => (typeof input[key] === 'string' ? input[key].trim() : '')
  const before = text('before')
  const after = text('after')
  const prompt = text('prompt')
  if (!before || !after) return { error: '도입 전·후 장면이 비어 있습니다.' }
  if (before.length > MAX_SCENE || after.length > MAX_SCENE) return { error: `장면 설명은 ${MAX_SCENE}자 이하여야 합니다.` }
  if (!prompt) return { error: '영상 프롬프트가 비어 있습니다.' }
  if (prompt.length > MAX_VIDEO_PROMPT) return { error: `영상 프롬프트는 ${MAX_VIDEO_PROMPT}자 이하여야 합니다.` }
  const duration = Number(input.duration)
  if (!durations.includes(duration)) return { error: `영상 길이는 ${durations.join('·')}초 중 하나여야 합니다.` }
  return { value: { before, after, prompt, duration } }
}

// 시나리오는 글 모델로 만든다 (형식이 틀리면 한 번 더). 길이가 선택지에 없으면 가장 긴 길이로 맞춘다
async function planVideo(idea, textModel, videoModel) {
  const title = idea.proposal?.title ?? idea.title
  const messages = [
    { role: 'system', content: VIDEO_PLAN_PROMPT },
    {
      role: 'user',
      content: `제목: ${title}\n대상 업무: ${idea.target}\nAI 활용 아이디어: ${idea.proposal?.approach ?? idea.idea}\n영상 길이 선택지(초): ${videoModel.durations.join(', ')}`,
    },
  ]
  let lastError = ''
  let cost = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = await callOpenRouter({ model: textModel, messages }, 60000)
    cost += Number(body.usage?.cost) || 0
    const content = body.choices?.[0]?.message?.content
    const raw = typeof content === 'string' ? content : ''
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    let parsed = null
    try {
      parsed = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null
    } catch {
      // 아래에서 다시 시도
    }
    if (parsed && !videoModel.durations.includes(Number(parsed.duration))) parsed.duration = videoModel.durations.at(-1)
    const { value, error } = parsed ? validateScenario(parsed, videoModel.durations) : { error: '시나리오를 JSON으로 받지 못했습니다.' }
    if (value) return { scenario: value, textModel: body.model ?? textModel, cost }
    lastError = `${error} (${body.model ?? textModel})`
  }
  throw new UpstreamError(lastError)
}

// 영상 작업 제출. 첫 장면은 화면이 16:9로 맞춰 보낸 대표 이미지(data URL)
async function submitVideo({ model, prompt, duration, audio, firstFrame }) {
  const body = await callOpenRouterPath(
    '/videos',
    {
      model: model.id,
      prompt,
      duration,
      resolution: model.resolution,
      aspect_ratio: VIDEO_ASPECT_RATIO,
      ...(model.audio && { generate_audio: audio }),
      frame_images: [{ type: 'image_url', image_url: { url: firstFrame }, frame_type: 'first_frame' }],
    },
    60000,
  )
  if (!body.id || !body.polling_url) throw new UpstreamError('영상 작업 정보를 받지 못했습니다.')
  return body
}

function openRouterAuth() {
  return { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY.trim()}` }
}

// 만드는 중인 영상을 확인한다. 끝나면 mp4를 받아 DB에 저장하고, 실패·시간 초과는 에러를 남긴다
let videoPolling = false
async function pollVideos() {
  if (videoPolling || !process.env.OPENROUTER_API_KEY?.trim()) return
  videoPolling = true
  try {
    const { rows } = await pool.query("SELECT idea_id, job_id, polling_url, created_at FROM idea_videos WHERE status = 'generating'")
    for (const row of rows) {
      try {
        await pollVideo(row)
      } catch (err) {
        // 네트워크 오류 등은 다음 확인 때 다시 시도한다
        console.error(`영상 상태를 확인하지 못했습니다. (${row.job_id}, ${err.message})`)
      }
    }
  } catch (err) {
    console.error('영상 작업 목록을 읽지 못했습니다:', err.message)
  } finally {
    videoPolling = false
  }
}

async function failVideo(row, error) {
  await pool.query("UPDATE idea_videos SET status = 'failed', error = $3, finished_at = now() WHERE idea_id = $1 AND job_id = $2", [
    row.idea_id,
    row.job_id,
    error,
  ])
}

async function pollVideo(row) {
  if (Date.now() - row.created_at.getTime() > VIDEO_TIMEOUT) return failVideo(row, '시간이 너무 오래 걸려 멈췄습니다.')
  const res = await fetch(new URL(row.polling_url, 'https://openrouter.ai'), {
    headers: openRouterAuth(),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const job = await res.json()
  if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
    console.error(`영상 생성 실패 (${row.job_id}): ${job.error ?? job.status}`)
    return failVideo(row, `영상을 만들지 못했습니다. (${job.error ?? job.status})`)
  }
  if (job.status !== 'completed') return

  const videoUrl = job.unsigned_urls?.[0] ?? `${OPENROUTER_URL}/videos/${job.id}/content?index=0`
  const video = await fetch(videoUrl, {
    headers: videoUrl.startsWith('https://openrouter.ai/api/') ? openRouterAuth() : undefined,
    signal: AbortSignal.timeout(60000),
  })
  if (!video.ok) throw new Error(`영상 내려받기 HTTP ${video.status}`)
  const data = Buffer.from(await video.arrayBuffer())
  const mime = video.headers.get('content-type')?.split(';')[0] || 'video/mp4'
  await pool.query(
    `UPDATE idea_videos SET status = 'ready', data = $3, mime = $4, cost = $5, finished_at = now()
     WHERE idea_id = $1 AND job_id = $2`,
    [row.idea_id, row.job_id, data, mime, Number(job.usage?.cost) || null],
  )
  console.log(`영상 완료 (${row.job_id}, ${data.length} bytes, $${job.usage?.cost ?? '?'})`)
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  if (path === '/api/ideas' && req.method === 'GET') {
    const { rows } = await pool.query(`${IDEA_SELECT} ORDER BY i.created_at DESC`)
    return send(res, 200, rows.map(toIdea))
  }

  if (path === '/api/ideas' && req.method === 'POST') {
    let body
    try {
      body = await readJson(req)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' })
    }
    const { value, error } = validate(body ?? {})
    if (error) return send(res, 400, { error })

    // 같은 id가 이미 있으면(재시도·이전 데이터 이전) 기존 행을 그대로 돌려준다
    const { rows } = await pool.query(
      `INSERT INTO ideas (id, title, target, idea, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
       RETURNING *`,
      [value.id, value.title, value.target, value.idea, value.createdAt],
    )
    return send(res, 201, toIdea(rows[0]))
  }

  const match = path.match(/^\/api\/ideas\/([^/]+)$/)
  // 카드 하나 (영상을 만드는 동안 화면이 상태를 다시 읽는다)
  if (match && req.method === 'GET') {
    const idea = await findIdea(decodeURIComponent(match[1]))
    return idea ? send(res, 200, idea) : send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
  }
  if (match && req.method === 'DELETE') {
    const id = decodeURIComponent(match[1])
    const { rowCount } = await pool.query('DELETE FROM ideas WHERE id = $1', [id])
    return rowCount ? send(res, 204) : send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
  }

  // AI 기획안 적용. 원래 제목·대상 업무·아이디어는 그대로 두고 proposal만 바꾼다
  if (match && req.method === 'PATCH') {
    let body
    try {
      body = await readJson(req)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' })
    }
    const { value, error } = validateProposal(body?.proposal)
    if (error) return send(res, 400, { error })
    const id = decodeURIComponent(match[1])
    const { rowCount } = await pool.query('UPDATE ideas SET proposal = $2 WHERE id = $1', [id, value])
    return rowCount ? send(res, 200, await findIdea(id)) : send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
  }

  // 대표 이미지: 파일 보기(GET) · 적용(PUT) · 지우기(DELETE)
  const imageMatch = path.match(/^\/api\/ideas\/([^/]+)\/image$/)
  if (imageMatch && req.method === 'GET') {
    const { rows } = await pool.query('SELECT mime, data FROM idea_images WHERE idea_id = $1', [
      decodeURIComponent(imageMatch[1]),
    ])
    if (!rows[0]) return send(res, 404, { error: '이미지가 없습니다.' })
    // 주소에 저장 시각(v)이 붙어 있어 이미지가 바뀌면 주소도 바뀐다
    res.writeHead(200, { 'Content-Type': rows[0].mime, 'Cache-Control': 'private, max-age=31536000, immutable' })
    return res.end(rows[0].data)
  }

  // 미리보기에서 적용을 누르면 저장한다. 카드당 한 장이라 이전 이미지는 바뀐다
  if (imageMatch && req.method === 'PUT') {
    let body
    try {
      body = await readJson(req, IMAGE_BODY_LIMIT)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않거나 이미지가 너무 큽니다.' })
    }
    const kind = body?.kind
    if (kind !== 'photo' && kind !== 'generated') return send(res, 400, { error: '이미지 종류가 올바르지 않습니다.' })
    const { value: image, error } = parseDataUrl(body.image)
    if (error) return send(res, 400, { error })
    let caption = null
    if (kind === 'photo') {
      caption = typeof body.caption === 'string' ? body.caption.trim() : ''
      if (!caption) return send(res, 400, { error: '사진 설명이 비어 있습니다.' })
      if (caption.length > MAX_CAPTION) return send(res, 400, { error: `사진 설명은 ${MAX_CAPTION}자 이하여야 합니다.` })
    }
    const model = typeof body.model === 'string' ? body.model.slice(0, 200) : null

    const id = decodeURIComponent(imageMatch[1])
    const { rowCount } = await pool.query('SELECT 1 FROM ideas WHERE id = $1', [id])
    if (!rowCount) return send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
    await pool.query(
      `INSERT INTO idea_images (idea_id, kind, mime, data, caption, model)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idea_id) DO UPDATE SET
         kind = EXCLUDED.kind, mime = EXCLUDED.mime, data = EXCLUDED.data,
         caption = EXCLUDED.caption, model = EXCLUDED.model, created_at = now()`,
      [id, kind, image.mime, image.data, caption, model],
    )
    return send(res, 200, await findIdea(id))
  }

  if (imageMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(imageMatch[1])
    await pool.query('DELETE FROM idea_images WHERE idea_id = $1', [id])
    const idea = await findIdea(id)
    return idea ? send(res, 200, idea) : send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
  }

  // 활용 장면 영상: 파일 보기(GET, 탐색용 Range 지원) · 만들기(POST) · 지우기(DELETE)
  const videoMatch = path.match(/^\/api\/ideas\/([^/]+)\/video$/)
  if (videoMatch && req.method === 'GET') {
    const { rows } = await pool.query("SELECT mime, data FROM idea_videos WHERE idea_id = $1 AND status = 'ready'", [
      decodeURIComponent(videoMatch[1]),
    ])
    if (!rows[0]) return send(res, 404, { error: '영상이 없습니다.' })
    const { mime, data } = rows[0]
    const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable' }
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
    if (range && (range[1] || range[2])) {
      // bytes=시작-끝, bytes=시작-, bytes=-끝에서부터
      let start = range[1] ? Number(range[1]) : data.length - Number(range[2])
      let end = range[1] && range[2] ? Number(range[2]) : data.length - 1
      start = Math.max(0, start)
      end = Math.min(end, data.length - 1)
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${data.length}` })
        return res.end()
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 })
      return res.end(data.subarray(start, end + 1))
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length })
    return res.end(data)
  }

  // 시나리오 패널에서 "만들기"를 눌렀을 때만 온다. 작업만 제출하고 바로 돌려준다 (완료는 pollVideos가 확인)
  if (videoMatch && req.method === 'POST') {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return send(res, 503, { error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    let body
    try {
      body = await readJson(req, IMAGE_BODY_LIMIT)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않거나 첫 장면 이미지가 너무 큽니다.' })
    }
    const id = decodeURIComponent(videoMatch[1])
    const modelId = typeof body?.model === 'string' && body.model ? body.model : DEFAULT_VIDEO_MODEL
    const { error: frameError } = parseDataUrl(body?.firstFrame)
    if (frameError) return send(res, 400, { error: `첫 장면 이미지: ${frameError}` })

    try {
      const model = (await getVideoModels()).find((m) => m.id === modelId)
      if (!model) return send(res, 400, { error: '사용할 수 없는 모델입니다.' })
      const { value: scenario, error } = validateScenario(body, model.durations)
      if (error) return send(res, 400, { error })
      const audio = model.audio && body.audio !== false

      const idea = await findIdea(id)
      if (!idea) return send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
      if (!idea.image) return send(res, 400, { error: '먼저 사진을 올리거나 이미지를 그려 주세요. 영상의 첫 장면으로 씁니다.' })
      if (idea.video?.status === 'generating') return send(res, 409, { error: '이미 영상을 만드는 중입니다.' })

      const job = await submitVideo({ model, prompt: scenario.prompt, duration: scenario.duration, audio, firstFrame: body.firstFrame })
      await pool.query(
        `INSERT INTO idea_videos (idea_id, status, job_id, polling_url, model, prompt, scenario, duration, audio, estimate)
         VALUES ($1, 'generating', $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (idea_id) DO UPDATE SET
           status = 'generating', job_id = EXCLUDED.job_id, polling_url = EXCLUDED.polling_url, model = EXCLUDED.model,
           prompt = EXCLUDED.prompt, scenario = EXCLUDED.scenario, duration = EXCLUDED.duration, audio = EXCLUDED.audio,
           estimate = EXCLUDED.estimate, cost = NULL, mime = NULL, data = NULL, error = NULL, created_at = now(), finished_at = NULL`,
        [
          id,
          job.id,
          job.polling_url,
          model.id,
          scenario.prompt,
          { before: scenario.before, after: scenario.after, prompt: scenario.prompt },
          scenario.duration,
          audio,
          videoCost(model, scenario.duration, audio),
        ],
      )
      console.log(`영상 작업 제출 (${job.id}, ${model.id}, ${scenario.duration}초)`)
      return send(res, 202, await findIdea(id))
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: `영상 작업을 시작하지 못했습니다. ${err.message}` })
    }
  }

  // 만드는 중에 지워도 OpenRouter 작업은 멈추지 않아 비용은 그대로 든다 (화면에서 안내)
  if (videoMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(videoMatch[1])
    await pool.query('DELETE FROM idea_videos WHERE idea_id = $1', [id])
    const idea = await findIdea(id)
    return idea ? send(res, 200, idea) : send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
  }

  if (path === '/api/health') {
    await pool.query('SELECT 1')
    return send(res, 200, { ok: true })
  }

  // OpenRouter 키가 읽히는지만 확인한다 (키 값은 응답·로그에 내보내지 않음)
  if (path === '/api/ai/ping' && req.method === 'GET') {
    return process.env.OPENROUTER_API_KEY?.trim()
      ? send(res, 200, { ok: true, keyLoaded: true })
      : send(res, 503, { ok: false, keyLoaded: false, error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
  }

  // 설정 팝업용 모델·가격 목록 (1시간 캐시, 목록 조회에는 키가 필요 없다)
  // type(또는 kind)=text(기본, 다듬기) · vision(사진 설명) · image(이미지 그리기) · speech(읽어 주기) · transcription(받아쓰기)
  if (path === '/api/ai/models' && req.method === 'GET') {
    const kind = url.searchParams.get('type') || url.searchParams.get('kind') || 'text'
    if (!MODEL_KINDS.includes(kind)) return send(res, 400, { error: '모델 종류가 올바르지 않습니다.' })
    try {
      return send(res, 200, await getModels(kind))
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: '모델 목록을 가져오지 못했습니다.' })
    }
  }

  // 아이디어를 기획안으로 다듬는다. 저장은 하지 않고 결과만 돌려준다 (적용은 PATCH /api/ideas/:id)
  if (path === '/api/ai/refine' && req.method === 'POST') {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return send(res, 503, { error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    let body
    try {
      body = await readJson(req)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' })
    }
    const model = typeof body?.model === 'string' && body.model ? body.model : DEFAULT_MODEL

    try {
      // 목록에 있는 모델만 호출한다 (아무 이름이나 받아 비용이 드는 호출을 막는다)
      const models = await getModels()
      if (!models.some((m) => m.id === model)) return send(res, 400, { error: '사용할 수 없는 모델입니다.' })

      // 화면이 보낸 내용이 아니라 DB에 저장된 아이디어를 다듬는다
      const { rows } = await pool.query('SELECT * FROM ideas WHERE id = $1', [String(body?.id ?? '')])
      if (!rows[0]) return send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })

      return send(res, 200, await refineIdea(rows[0], model))
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: 'AI로 다듬지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    }
  }

  // 사진 설명(describe)·이미지 그리기(draw). 저장하지 않고 결과만 돌려준다 (적용은 PUT /api/ideas/:id/image)
  if ((path === '/api/ai/describe' || path === '/api/ai/draw') && req.method === 'POST') {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return send(res, 503, { error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    const describing = path === '/api/ai/describe'
    let body
    try {
      body = await readJson(req, describing ? IMAGE_BODY_LIMIT : undefined)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않거나 이미지가 너무 큽니다.' })
    }
    const fallback = describing ? DEFAULT_VISION_MODEL : DEFAULT_IMAGE_MODEL
    const modelId = typeof body?.model === 'string' && body.model ? body.model : fallback
    if (describing) {
      const { error } = parseDataUrl(body?.image)
      if (error) return send(res, 400, { error })
    }

    try {
      // 목록에 있는 모델만 호출한다 (아무 이름이나 받아 비용이 드는 호출을 막는다)
      const model = (await getModels(describing ? 'vision' : 'image')).find((m) => m.id === modelId)
      if (!model) return send(res, 400, { error: '사용할 수 없는 모델입니다.' })

      const { rows } = await pool.query('SELECT * FROM ideas WHERE id = $1', [String(body?.id ?? '')])
      if (!rows[0]) return send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })

      return send(res, 200, describing ? await describePhoto(body.image, model.id) : await drawImage(rows[0], model))
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, {
        error: describing ? '사진을 설명하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '이미지를 그리지 못했습니다. 잠시 후 다시 시도해 주세요.',
      })
    }
  }

  // 카드 읽어 주기. 화면이 보낸 글이 아니라 DB의 카드 내용을 읽고, 응답은 음성 파일(mp3)이다
  if (path === '/api/ai/speak' && req.method === 'POST') {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return send(res, 503, { error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    let body
    try {
      body = await readJson(req)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' })
    }
    const modelId = typeof body?.model === 'string' && body.model ? body.model : DEFAULT_SPEECH_MODEL

    try {
      const { model, voice, error } = await resolveSpeech(modelId, body.voice)
      if (error) return send(res, 400, { error })

      const { rows } = await pool.query('SELECT * FROM ideas WHERE id = $1', [String(body?.id ?? '')])
      if (!rows[0]) return send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })

      const { audio, mime, cost } = await speakText(speechText(rows[0]), model, voice)
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': audio.length,
        'X-AI-Model': model.id,
        'X-AI-Voice': voice ?? '',
        'X-AI-Cost': String(cost),
      })
      return res.end(audio)
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: '읽어 주지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    }
  }

  // 받아쓰기. 녹음(base64)을 글로 바꿔 돌려준다 (새 카드 입력란에 넣는 것은 화면이 한다)
  if (path === '/api/ai/listen' && req.method === 'POST') {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return send(res, 503, { error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    let body
    try {
      body = await readJson(req, AUDIO_BODY_LIMIT)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않거나 녹음이 너무 깁니다.' })
    }
    const modelId = typeof body?.model === 'string' && body.model ? body.model : DEFAULT_TRANSCRIPTION_MODEL
    if (!AUDIO_FORMATS.includes(body?.format)) return send(res, 400, { error: '지원하지 않는 녹음 형식입니다.' })
    const audio = typeof body.audio === 'string' && /^[A-Za-z0-9+/=]+$/.test(body.audio) ? body.audio : ''
    const bytes = Math.floor((audio.length * 3) / 4)
    if (!bytes) return send(res, 400, { error: '녹음이 비어 있습니다.' })
    if (bytes > MAX_AUDIO_BYTES) return send(res, 400, { error: '녹음이 너무 깁니다.' })

    try {
      const models = await getModels('transcription')
      if (!models.some((m) => m.id === modelId)) return send(res, 400, { error: '사용할 수 없는 모델입니다.' })
      return send(res, 200, await transcribeAudio(audio, body.format, modelId))
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: '받아쓰지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    }
  }

  // 활용 장면 영상 시나리오. 글 모델이 도입 전·후 장면과 영상 프롬프트를 쓰고, 예상 금액을 함께 준다 (영상은 만들지 않음)
  if (path === '/api/ai/video/plan' && req.method === 'POST') {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return send(res, 503, { error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    let body
    try {
      body = await readJson(req)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' })
    }
    const modelId = typeof body?.model === 'string' && body.model ? body.model : DEFAULT_VIDEO_MODEL
    const textModelId = typeof body?.textModel === 'string' && body.textModel ? body.textModel : DEFAULT_MODEL

    try {
      const [videoModels, textModels] = await Promise.all([getVideoModels(), getModels('text')])
      const model = videoModels.find((m) => m.id === modelId)
      if (!model) return send(res, 400, { error: '사용할 수 없는 영상 모델입니다.' })
      if (!textModels.some((m) => m.id === textModelId)) return send(res, 400, { error: '사용할 수 없는 글 모델입니다.' })

      const idea = await findIdea(String(body?.id ?? ''))
      if (!idea) return send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
      if (!idea.image) return send(res, 400, { error: '먼저 사진을 올리거나 이미지를 그려 주세요. 영상의 첫 장면으로 씁니다.' })

      const { scenario, textModel, cost } = await planVideo(idea, textModelId, model)
      return send(res, 200, { scenario, model, textModel, cost })
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: '시나리오를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    }
  }

  // 출근길 브리핑. 날씨·뉴스·주가를 동시에 모아 글(텍스트 모델)과 음성(읽어 주기 모델)으로 돌려준다
  // 셋 중 일부가 실패하면 "정보 없음"으로 쓰고, 음성이 실패해도 글은 돌려준다
  if (path === '/api/briefing' && req.method === 'POST') {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return send(res, 503, { error: 'OPENROUTER_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    let body
    try {
      body = await readJson(req)
    } catch {
      return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' })
    }

    // 종목은 화면의 내 종목 목록(없으면 기본 4종목). 규칙은 /api/stock과 같다
    const rawSymbols = Array.isArray(body?.symbols) ? body.symbols : DEFAULT_SYMBOLS
    const symbols = [...new Set(rawSymbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))]
    if (symbols.length > MAX_SYMBOLS) return send(res, 400, { error: `종목은 ${MAX_SYMBOLS}개까지 쓸 수 있습니다.` })
    if (!symbols.every((s) => SYMBOL_PATTERN.test(s))) return send(res, 400, { error: '종목 기호 형식이 올바르지 않습니다.' })
    const textModel = typeof body.model === 'string' && body.model ? body.model : DEFAULT_MODEL
    const speechModelId = typeof body.speechModel === 'string' && body.speechModel ? body.speechModel : DEFAULT_SPEECH_MODEL

    try {
      // 비용이 드는 호출 전에 모델부터 확인한다
      if (!(await getModels('text')).some((m) => m.id === textModel)) return send(res, 400, { error: '사용할 수 없는 모델입니다.' })
      const speech = await resolveSpeech(speechModelId, body.voice)
      if (speech.error) return send(res, 400, { error: speech.error })

      const gathered = await gatherBriefing(symbols, BRIEFING_NEWS_QUERY)
      const sources = { weather: Boolean(gathered.weather), news: Boolean(gathered.news), stocks: Boolean(gathered.stocks) }
      if (!Object.values(sources).some(Boolean)) return send(res, 502, { error: '브리핑할 정보를 하나도 가져오지 못했습니다.' })

      const written = await writeBriefing(briefingFacts(gathered, BRIEFING_NEWS_QUERY), textModel)

      let audio = null
      let audioError = null
      try {
        const spoken = await speakText(written.text, speech.model, speech.voice)
        audio = {
          url: `data:${spoken.mime};base64,${spoken.audio.toString('base64')}`,
          model: speech.model.id,
          voice: speech.voice,
          cost: spoken.cost,
        }
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err
        console.error(`브리핑 음성: ${err.message}`)
        audioError = '음성을 만들지 못했습니다. 글만 보여 드립니다.'
      }
      return send(res, 200, { text: written.text, sources, model: written.model, cost: written.cost, audio, audioError })
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: '브리핑을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    }
  }

  // 천안 현재 날씨 (10분 캐시, 키는 응답·로그에 내보내지 않음)
  if (path === '/api/weather' && req.method === 'GET') {
    if (!process.env.KMA_API_KEY?.trim()) {
      return send(res, 503, { error: 'KMA_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    try {
      return send(res, 200, await getWeather())
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: '날씨 정보를 가져오지 못했습니다.' })
    }
  }

  // 뉴스 검색. 네이버 키는 헤더로만 보내고 응답·로그에 내보내지 않는다
  if (path === '/api/news' && req.method === 'GET') {
    if (!process.env.NAVER_CLIENT_ID?.trim() || !process.env.NAVER_CLIENT_SECRET?.trim()) {
      return send(res, 503, { error: 'NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 없습니다. .env 파일을 확인해 주세요.' })
    }
    const query = url.searchParams.get('q')?.trim() ?? ''
    if (!query) return send(res, 400, { error: '검색어를 입력해 주세요.' })
    if (query.length > MAX_QUERY) return send(res, 400, { error: `검색어는 ${MAX_QUERY}자 이하로 입력해 주세요.` })
    try {
      return send(res, 200, await fetchNews(query))
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err
      console.error(err.message)
      return send(res, 502, { error: '뉴스를 가져오지 못했습니다.' })
    }
  }

  // 주식 시세 (여러 종목). Finnhub 키는 token 쿼리로만 보내고 응답·로그에 내보내지 않는다
  if (path === '/api/stock' && req.method === 'GET') {
    if (!process.env.FINNHUB_API_KEY?.trim()) {
      return send(res, 503, { error: 'FINNHUB_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    const raw = url.searchParams.get('s')?.trim() || DEFAULT_SYMBOLS.join(',')
    const symbols = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
    if (symbols.length === 0 || symbols.length > MAX_SYMBOLS) {
      return send(res, 400, { error: `종목은 1~${MAX_SYMBOLS}개까지 조회할 수 있습니다.` })
    }
    if (!symbols.every((s) => SYMBOL_PATTERN.test(s))) {
      return send(res, 400, { error: '종목 기호 형식이 올바르지 않습니다.' })
    }

    // 종목마다 따로 호출해서 한 종목이 실패해도 나머지는 돌려준다
    const quotes = await Promise.all(symbols.map(getQuote))
    if (quotes.every((q) => q.error)) return send(res, 502, { error: '시세를 가져오지 못했습니다.' })
    return send(res, 200, quotes)
  }

  send(res, 404, { error: 'Not Found' })
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err)
    if (!res.headersSent) send(res, 500, { error: '서버 오류가 발생했습니다.' })
  })
})

try {
  await initSchema()
} catch (err) {
  console.error('DB 연결 또는 테이블 생성에 실패했습니다:', err.message)
  process.exit(1)
}

server.on('error', (err) => {
  // 다른 포트로 넘어가지 않고 멈춘다 (vite --strictPort와 같은 원칙)
  console.error(`포트 ${API_PORT}에서 서버를 시작할 수 없습니다:`, err.message)
  process.exit(1)
})

server.listen(API_PORT, () => {
  console.log(`API 서버: http://localhost:${API_PORT}`)
  // 만드는 중인 영상을 주기적으로 확인한다 (서버를 다시 켜도 DB에 남은 작업부터 이어서 확인)
  pollVideos()
  setInterval(pollVideos, VIDEO_POLL_INTERVAL)
})
