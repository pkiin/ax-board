// 백엔드(dev:server)와 프런트(dev)를 한 터미널에서 같이 띄운다.
// 한쪽이 종료되면(포트 충돌 등) 다른 쪽도 함께 내린다.
import { spawn } from 'node:child_process'

if (!process.env.PORT) {
  console.error('PORT 환경 변수가 없습니다. 계정별 포트($PORT)를 확인해 주세요.')
  process.exit(1)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tasks = [
  { name: 'api', color: '\x1b[35m', script: 'dev:server' },
  { name: 'web', color: '\x1b[36m', script: 'dev' },
]

const children = []
let shuttingDown = false

function prefixLines(stream, out, label) {
  let rest = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()
    for (const line of lines) out.write(`${label} ${line}\n`)
  })
  stream.on('end', () => {
    if (rest) out.write(`${label} ${rest}\n`)
  })
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  process.exitCode = code
}

for (const task of tasks) {
  const label = `${task.color}[${task.name}]\x1b[0m`
  const child = spawn(npm, ['run', '--silent', task.script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  prefixLines(child.stdout, process.stdout, label)
  prefixLines(child.stderr, process.stderr, label)
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`${label} 종료됨 (${signal ?? code}). 나머지 서버도 종료합니다.`)
    }
    shutdown(code ?? 1)
  })
  children.push(child)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
