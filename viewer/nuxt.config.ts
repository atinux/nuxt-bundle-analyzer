import process from 'node:process'

// A single-page app. `nuxt generate` builds the one the package serves with its runs from `/data`;
// `nuxt build` builds the hosted viewer, which stores the runs GitHub Actions upload.
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  $development: {
    // Run `nuxt-bundle-analyzer` in a project, then point `ANALYZE_SERVER` at the server it starts.
    routeRules: {
      '/data/**': { proxy: `${process.env.ANALYZE_SERVER || 'http://localhost:3000'}/data/**` },
    },
  },
  ssr: false,
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Nuxt Bundle Analyzer',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark' },
  ui: {
    // Only generate the theme and CSS of the components in use.
    experimental: { componentDetection: true },
  },
  // The app is never updated in place, so it has no use for the build manifest.
  experimental: { appManifest: false },
  compatibilityDate: '2026-10-01',
  runtimeConfig: {
    oidc: {
      // GitHub Actions' issuer; tests point these at their own.
      issuer: 'https://token.actions.githubusercontent.com',
      jwksUrl: 'https://token.actions.githubusercontent.com/.well-known/jwks',
      /** The audience tokens must be issued for; the viewer's own origin when empty. */
      audience: '',
      /**
       * Comma-separated workflows allowed to upload, as `owner/repo/.github/workflows/file.yml@refs/heads/main`.
       * Set with `NUXT_OIDC_ALLOWED_WORKFLOWS`.
       */
      allowedWorkflows: '',
    },
  },
  hooks: {
    // The package's copy, from `nuxt generate`, is written apart from the hosted build.
    'nitro:config': function (config) {
      if (config.static) {
        config.output = { ...config.output, dir: '.output-static', publicDir: '.output-static/public' }
      }
      // The hosted build only has the runs of pull requests, so its home page has none to fetch.
      config.runtimeConfig!.public = { ...config.runtimeConfig!.public, hosted: !config.static && !config.dev }
    },
  },
  // Inter and Outfit are downloaded at build time and shipped with the package; Latin covers the UI.
  fonts: {
    defaults: {
      subsets: ['latin'],
      weights: [400, 500, 600],
      styles: ['normal'],
    },
  },
  // Bundle every icon used, so the analyzer works offline instead of fetching icons from the Iconify API.
  icon: {
    provider: 'none',
    clientBundle: { scan: true },
  },
})
