import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const python = path.resolve(root, '.venv', 'Scripts', 'python.exe')
const PORT = 8765

// The real backend runs with the test parser and an empty Gemini key (a blank env var beats .env), so the e2e run never calls Gemini.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.js',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 900 }, acceptDownloads: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `"${python}" -m uvicorn backend.app:app --port ${PORT} --log-level warning`,
    cwd: root,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, DEALPILOT_EXTRACTOR: 'fixture', GEMINI_API_KEY: '', GOOGLE_API_KEY: '' },
  },
})
