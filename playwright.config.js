import { defineConfig } from '@playwright/test'

/**
 * Browser tests run against the dev container (see README). There is no Chrome
 * in this container, so the tests attach to a headless one over CDP:
 * docker run -d --name deliver-axi-chrome --shm-size=1g -p 127.0.0.1:9222:9222 chromedp/headless-shell
 */
export default defineConfig({
	testDir: './tests/e2e',
	globalSetup: './tests/e2e/fixtures.js',
	timeout: 60000,
	expect: { timeout: 10000 },
	use: {
		baseURL: process.env.DELIVER_TEST_URL ?? 'http://localhost:8080',
	},
	reporter: process.env.CI ? 'github' : 'list',
})
