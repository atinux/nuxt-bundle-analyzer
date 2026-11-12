// Picks the pages `--prerender` records: `--extends ./prerender-layer` adds this layer.
const urls = ['/chart', '/stats']

export default defineNuxtConfig({
  nitro: {
    prerender: {
      routes: urls,
      // Also leaves out the links the app crawls or the routes a module adds.
      ignore: [
        (path: string) => !urls.includes(path),
      ],
    },
  },
})
