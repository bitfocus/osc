import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.{ts,mjs}'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			// Type declarations only
			exclude: ['src/types.ts', 'src/**/*.d.ts'],
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
