import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // A spy declared once for a `describe` starts each case empty, so a
    // `toHaveBeenCalledWith` cannot pass on a call from the case before it.
    clearMocks: true,
    globals: true,
  },
})
