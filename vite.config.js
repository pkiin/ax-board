import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /api 요청은 백엔드($PORT + 100)로 넘긴다
const apiPort = Number(process.env.PORT) + 100

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
  preview: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
})
