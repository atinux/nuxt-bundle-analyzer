import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/module.ts', 'src/cli.ts'],
  format: 'esm',
  dts: { entry: 'src/module.ts' },
  // Nuxt and its kit come from the project being analyzed.
  deps: {
    neverBundle: [
      'nuxt',
      '@nuxt/kit',
      '@nuxt/schema',
      'sonda',
    ],
  },
})
