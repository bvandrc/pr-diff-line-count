import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolves the `@/*` alias from `tsconfig.json`, so it's declared only there.
  resolve: { tsconfigPaths: true },
  test: {
    // A spy declared once for a `describe` starts each case empty, so a
    // `toHaveBeenCalledWith` cannot pass on a call from the case before it.
    clearMocks: true,
    globals: true,
  },
})
