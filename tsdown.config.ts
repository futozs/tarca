import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  platform: 'neutral',
  target: 'es2023',
  clean: true,
  sourcemap: false,
  deps: { neverBundle: [/^node:/] },
})
