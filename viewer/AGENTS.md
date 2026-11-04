# Viewer

The viewer is a Nuxt 4 single-page app (`ssr: false`) built with Nuxt UI 4 and Tailwind CSS 4. It has no pages directory and no router: `app/app.vue` keeps the whole UI state in the URL query, and `app/utils/data.ts` loads and shapes the Sonda reports. `server/` holds the Nitro routes of the hosted viewer, which stores the runs GitHub Actions upload.

- Load the `vue-best-practices` skill before changing `.vue` files or composables. It is generic Vue 3, so also follow Nuxt conventions: auto-imported Vue and Nuxt APIs, Nuxt UI components before custom ones, and icons from the bundled `lucide` and `vscode-icons` sets, since the analyzer works offline.
- Load the `vue-debug-guides` skill when diagnosing a Vue runtime error, warning, or reactivity bug.
- For a local fix, keep the existing component boundaries; split components or add composables only in a refactor that asks for it.
- Check changes with `pnpm typecheck` and `pnpm lint` from the repository root, and look at the result in `pnpm dev:viewer`.
