import { defineConfig } from 'vitest/config'

// Vitest covers pure client logic only; the browser flows are Playwright's,
// and its specs live in tests/e2e (spec: Testing Decisions).
export default defineConfig({
	test: {
		include: ['src/**/*.spec.js'],
	},
})
