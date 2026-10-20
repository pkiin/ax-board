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
