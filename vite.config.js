import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 공용 서버라 계정별 포트($PORT)만 쓰고, 사용 중이어도 다른 번호로 넘어가지 않는다(strictPort).
// /api 요청은 백엔드($PORT + 100)로 넘긴다.
export default defineConfig(({ command }) => {
  const port = Number(process.env.PORT)
  if (command === 'serve' && !Number.isInteger(port)) {
    throw new Error('PORT 환경 변수가 없습니다. 계정별 포트($PORT)를 확인해 주세요.')
  }

  const proxy = { '/api': `http://localhost:${port + 100}` }
  return {
    plugins: [react()],
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
  }
})
