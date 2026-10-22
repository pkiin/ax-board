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
}

function toIdea(row) {
  return {
    id: row.id,
    title: row.title,
    target: row.target,
    idea: row.idea,
    createdAt: row.created_at.toISOString(),
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 100_000) {
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

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  if (path === '/api/ideas' && req.method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM ideas ORDER BY created_at DESC')
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
  if (match && req.method === 'DELETE') {
    const id = decodeURIComponent(match[1])
    const { rowCount } = await pool.query('DELETE FROM ideas WHERE id = $1', [id])
    return rowCount ? send(res, 204) : send(res, 404, { error: '아이디어를 찾을 수 없습니다.' })
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

  // 천안 현재 날씨. 기상청 호출 한도를 아끼려고 10분 동안 메모리에 캐시한다 (키는 응답·로그에 내보내지 않음)
  if (path === '/api/weather' && req.method === 'GET') {
    if (!process.env.KMA_API_KEY?.trim()) {
      return send(res, 503, { error: 'KMA_API_KEY가 없습니다. .env 파일을 확인해 주세요.' })
    }
    if (weatherCache && weatherCache.expiresAt > Date.now()) return send(res, 200, weatherCache.data)
    try {
      const data = await fetchWeather()
      weatherCache = { data, expiresAt: Date.now() + WEATHER_TTL }
      return send(res, 200, data)
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
})
