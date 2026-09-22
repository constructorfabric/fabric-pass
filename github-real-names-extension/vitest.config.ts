import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // Content script fixtures are real GitHub HTML pages with links to external
    // CSS/JS (github.githubassets.com). Without this, happy-dom dutifully tries to
    // fetch them over the network on every fixture parse — slow, and it fails in offline CI.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
