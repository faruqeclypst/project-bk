import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_PB_URL': JSON.stringify(process.env.VITE_PB_URL || 'http://206.189.32.190:8090')
  }
})
