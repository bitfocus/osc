import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.{js,mjs}'],
		coverage: {
			provider: 'v8',
			include: ['src/**'],
			reporter: ['text', 'html'],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
})
