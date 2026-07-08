import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // web/ and video/ are separate sub-projects with their own test tooling (Playwright, none yet).
    include: ['*.test.ts'],
  },
})
