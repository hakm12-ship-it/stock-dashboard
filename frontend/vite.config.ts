import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 폰에서 접속 가능하도록 host 노출 + /api 는 백엔드(8000)로 프록시
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
