import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { blueprintSync } from './src/server/blueprint-sync'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), blueprintSync()],
})
