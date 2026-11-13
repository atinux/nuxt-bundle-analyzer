<script setup lang="ts">
import type { ChunkInfo, Metric, PageInfo, PrerenderedInfo, Target } from '~/utils/data'
import { appChunks, formatBytes, pagesDir } from '~/utils/data'

const props = defineProps<{
  pages: PageInfo[]
  chunks: ChunkInfo[]
  /** The URLs rendered with `--urls`, each listed under the page of its route. */
  prerendered: PrerenderedInfo[]
  metric: Metric
  search: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
  openChunk: [file: string]
}>()

const expanded = ref(new Set<string>())
function toggle(file: string) {
  expanded.value.has(file)
    ? expanded.value.delete(file)
    : expanded.value.add(file)
}

const urlsByPage = computed(() => new Map(props.pages.map(page => [
  page.file,
  // Under the page that renders its route only, not also under the parents of that page.
  props.prerendered.filter(url => url.page?.file === page.chunk.file),
])))
/** URLs whose HTML loads none of the pages, such as an SPA shell. */
const otherUrls = computed(() => {
  const pageChunks = new Set(props.pages.map(page => page.chunk.file))
  return props.prerendered.filter(url => !url.page || !pageChunks.has(url.page.file))
})

const query = computed(() => props.search.trim().toLowerCase())
const shown = computed(() => query.value
  ? props.pages.filter(page => [
      page.file,
      ...page.routes,
      ...page.chunk.contents.map(part => part.id),
      ...urlsByPage.value.get(page.file)!.map(url => url.url),
    ].some(text => text.toLowerCase().includes(query.value)))
  : props.pages)
const shownOtherUrls = computed(() => query.value
  ? otherUrls.value.filter(url => url.url.toLowerCase().includes(query.value))
  : otherUrls.value)

const everyPage = computed(() => appChunks(props.chunks))
const everyPageFiles = computed(() => new Set(everyPage.value.map(chunk => chunk.file)))
function chunkSize(chunk: ChunkInfo) {
  return chunk[props.metric] + chunk.css[props.metric]
}
function chunkName(chunk: ChunkInfo) {
  return chunk.file.split('/').pop()
}
// Largest first, so what takes the space comes first.
const everyPageSorted = computed(() => [...everyPage.value].sort((a, b) => chunkSize(b) - chunkSize(a)))
/** The chunks that import each chunk, statically or with `import()`. */
const importersOf = computed(() => {
  const byFile = new Map(props.chunks.map(chunk => [chunk.file, chunk]))
  const importers = new Map<string, ChunkInfo[]>()
  for (const chunk of props.chunks) {
    for (const file of new Set([
      ...chunk.imports,
      ...chunk.dynamicImports ?? [],
    ])) {
      if (byFile.has(file)) {
        importers.set(file, [
          ...importers.get(file) ?? [],
          chunk,
        ])
      }
    }
  }
  return importers
})

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1
    ? ''
    : 's'}`
}
/** Who imports the chunk, by when they load, such as `46 loaded on every page and 75 lazy`. */
function describeImporters(chunks: ChunkInfo[]) {
  const every = chunks.filter(chunk => everyPageFiles.value.has(chunk.file)).length
  const lazy = chunks.filter(chunk => chunk.loadedBy === 'lazy').length
  const pages = chunks.length - every - lazy
  const parts = [
    every && `${every} loaded on every page`,
    pages && `${pages} loaded by some pages`,
    lazy && `${lazy} lazy`,
  ].filter(Boolean) as string[]
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0] ?? ''
}
/**
 * Why the bundler gave a chunk every page loads a file of its own: chunks loaded only by some pages,
 * or lazily, import it too, directly or through the chunks that do, so it can't stay inside the entry.
 */
function whyOwnChunk(chunk: ChunkInfo) {
  const direct = importersOf.value.get(chunk.file) ?? []
  if (chunk.kind === 'entry') {
    return direct.length
      ? `The app's entry, which starts every page. ${plural(direct.length, 'chunk')} import from it: ${describeImporters(direct)}.`
      : 'The app\'s entry, which starts every page.'
  }
  if (direct.some(other => !everyPageFiles.value.has(other.file))) {
    return `Its own chunk because ${plural(direct.length, 'chunk')} import it: ${describeImporters(direct)}.`
  }
  // Only chunks every page loads import it, so look further up for the ones that are not.
  const reached = new Set<ChunkInfo>()
  const stack = [...direct]
  while (stack.length) {
    const next = stack.pop()!
    if (!reached.has(next)) {
      reached.add(next)
      stack.push(...importersOf.value.get(next.file) ?? [])
    }
  }
  const others = [...reached].filter(other => !everyPageFiles.value.has(other.file))
  return others.length
    ? `Its own chunk because ${plural(others.length, 'lazy or page chunk')} reach it through the ${plural(direct.length, 'chunk')} loaded on every page that import it.`
    : `${plural(direct.length, 'chunk')} loaded on every page import it.`
}

/** A large app loads dozens of chunks on every page, so the list starts with its largest. */
const EVERY_PAGE_LIMIT = 10
const showAllEveryPage = ref(false)
const everyPageShown = computed(() => showAllEveryPage.value
  ? everyPageSorted.value
  : everyPageSorted.value.slice(0, EVERY_PAGE_LIMIT))
const everyPageSize = computed(() => everyPage.value.reduce((sum, chunk) => sum + chunk[props.metric] + chunk.css[props.metric], 0))

/** What a page's route loads before it renders, apart from the chunks every page loads, which the table above lists. */
function pageSize(page: PageInfo) {
  return page.initial && page.initial[props.metric] - everyPageSize.value
}
</script>

<template>
  <section class="rounded-lg ring ring-default">
    <!-- Every page loads these before it renders, so they are listed once rather than in each page's size. -->
    <h3 class="flex items-center justify-between gap-4 border-b border-default bg-elevated/50 px-4 py-2 text-xs text-muted">
      <span class="flex items-center gap-2">
        Loaded on Every Page
        <!-- One request per chunk. Stylesheets are left out, as Nuxt can inline them in the HTML. -->
        <span class="text-dimmed" aria-hidden="true">·</span>
        <span class="text-dimmed">{{ everyPage.length === 1 ? '1 JS request' : `${everyPage.length} JS requests` }}</span>
      </span>
      <span class="text-sm text-highlighted">{{ formatBytes(everyPageSize) }}</span>
    </h3>
    <ul class="divide-y divide-default">
      <li v-for="chunk in everyPageShown" :key="chunk.file">
        <!-- The chevron, the name and the size share the first line; the second starts under the icon. -->
        <button class="flex w-full items-start gap-4 px-4 py-3 text-left hover:bg-elevated/50" :aria-expanded="expanded.has(chunk.file)" @click="toggle(chunk.file)">
          <UIcon name="i-lucide-chevron-right" class="mt-0.5 size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-90': expanded.has(chunk.file) }" />
          <div class="min-w-0 flex-1">
            <!-- The file the browser requests. -->
            <p class="flex items-center gap-2 font-mono text-sm text-highlighted">
              <FileIcon :path="chunk.file" class="size-4" />
              <span class="truncate">{{ chunkName(chunk) }}</span>
            </p>
            <!-- Its share of what every page loads, so what takes the space stands out. -->
            <div class="mt-1.5 h-1 rounded-full bg-elevated">
              <div class="h-1 rounded-full bg-primary" :style="{ width: `${Math.max(1, Math.round(chunkSize(chunk) / (everyPageSize || 1) * 100))}%` }" />
            </div>
          </div>
          <p class="w-32 shrink-0 text-right text-sm text-highlighted">
            <span class="sr-only">Size </span>{{ formatBytes(chunkSize(chunk)) }}
          </p>
        </button>
        <div v-if="expanded.has(chunk.file)" class="space-y-3 border-t border-default px-4 py-4 sm:ps-12">
          <p class="text-xs text-muted">
            {{ whyOwnChunk(chunk) }}
          </p>
          <ChunkContents :parts="chunk.contents" :metric="metric" @inspect="target => emit('inspect', target)" />
          <div class="flex items-center justify-between gap-3 text-xs text-muted">
            <span>{{ chunk.css[metric] ? `Its size includes ${formatBytes(chunk.css[metric])} of CSS.` : '' }}</span>
            <button class="flex shrink-0 items-center gap-1 hover:text-primary" @click="emit('openChunk', chunk.file)">
              Show in Chunks
              <UIcon name="i-lucide-arrow-right" class="size-3.5" />
            </button>
          </div>
        </div>
      </li>
      <li v-if="everyPage.length > EVERY_PAGE_LIMIT">
        <button class="w-full px-4 py-2.5 text-center text-sm text-muted hover:bg-elevated/50 hover:text-primary" @click="showAllEveryPage = !showAllEveryPage">
          {{ showAllEveryPage ? 'Show the 10 largest' : `Show all ${everyPage.length} files` }}
        </button>
      </li>
    </ul>
  </section>

  <div class="rounded-lg ring ring-default">
    <!-- The columns are named once here rather than on every row. -->
    <div class="flex items-center gap-4 border-b border-default bg-elevated/50 px-4 py-2 text-xs text-muted" aria-hidden="true">
      <span class="flex-1">{{ pages.length === 1 ? '1 Page' : `${pages.length} Pages` }}</span>
      <span class="w-32 shrink-0 text-right">Size</span>
    </div>
    <ul class="divide-y divide-default">
      <li v-for="page in shown" :key="page.file">
        <!-- The chevron, the file and the size share the first line; the second starts under the icon. -->
        <button class="flex w-full items-start gap-4 px-4 py-3 text-left hover:bg-elevated/50" :aria-expanded="expanded.has(page.file)" @click="toggle(page.file)">
          <UIcon name="i-lucide-chevron-right" class="mt-0.5 size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-90': expanded.has(page.file) }" />
          <div class="min-w-0 flex-1">
            <!-- Narrow screens leave out the pages directory every page shares, so the file name fits. -->
            <p class="flex items-center gap-2 font-mono text-sm text-highlighted">
              <FileIcon :path="page.file" class="size-4" />
              <span class="truncate"><span class="max-sm:hidden">{{ pagesDir(page.file) }}</span>{{ page.file.slice(pagesDir(page.file).length) }}</span>
            </p>
            <p class="mt-0.5 truncate text-xs text-muted">
              <span v-if="page.route" class="font-mono">{{ page.route }}</span>
              <template v-else>
                Parent of <span class="font-mono">{{ page.routes.join(', ') }}</span>
              </template>
              <span v-if="urlsByPage.get(page.file)!.length" class="text-primary"> · {{ urlsByPage.get(page.file)!.length === 1 ? '1 prerendered URL' : `${urlsByPage.get(page.file)!.length} prerendered URLs` }}</span>
            </p>
          </div>
          <div class="w-32 shrink-0 text-right">
            <p v-if="page.initial" class="text-sm text-highlighted">
              <span class="sr-only">Size </span>{{ formatBytes(pageSize(page)!) }}
            </p>
            <p v-else class="text-sm text-muted">
              In its child routes
            </p>
          </div>
        </button>

        <div v-if="expanded.has(page.file)" class="space-y-6 border-t border-default px-4 py-4 sm:ps-12">
          <ChunkContents :parts="page.chunk.contents" :metric="metric" :scale="pageSize(page)" @inspect="target => emit('inspect', target)" />

          <section v-if="page.loads.length">
            <h4 class="mb-2 text-sm text-highlighted">
              Also Loaded Before It Renders
            </h4>
            <!-- With the page's chunk above, these add up to its size. -->
            <ChunkList :chunks="page.loads" :metric="metric" :scale="pageSize(page)" @open-chunk="file => emit('openChunk', file)" />
          </section>

          <section v-if="page.lazy.length">
            <h4 class="mb-2 text-sm text-highlighted">
              Loaded on Demand
            </h4>
            <ChunkList :chunks="page.lazy" :metric="metric" :scale="pageSize(page)" @open-chunk="file => emit('openChunk', file)" />
          </section>

          <section v-if="urlsByPage.get(page.file)!.length">
            <h4 class="text-sm text-highlighted">
              Prerendered URLs
            </h4>
            <p class="mt-1 mb-2 text-xs text-muted">
              What each URL's HTML preloads apart from the chunks every page loads: {{ page.initial ? `this page's ${formatBytes(pageSize(page)!)}` : 'its route' }}, plus the lazy-loaded components the page rendered, minus any route files the HTML doesn't load, such as stylesheets Nuxt inlines.
            </p>
            <PrerenderedUrls :urls="urlsByPage.get(page.file)!" :shared="everyPageFiles" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
          </section>
        </div>
      </li>
      <li v-if="shown.length === 0" class="px-4 py-6 text-center text-sm text-muted">
        No pages match this search. Clear it to see every page.
      </li>
    </ul>
  </div>

  <section v-if="shownOtherUrls.length" class="rounded-lg px-4 py-3 ring ring-default">
    <h4 class="text-sm text-highlighted">
      URLs Not Matched to a Page
    </h4>
    <p class="mt-1 mb-2 text-xs text-muted">
      Their HTML loads no page's chunk, such as an SPA shell or a page outside the app's routes.
    </p>
    <PrerenderedUrls :urls="shownOtherUrls" :shared="everyPageFiles" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
  </section>

  <!-- Routes only count what their static imports reach, so the callout says how to measure what a rendered page loads. -->
  <UAlert
    v-if="!prerendered.length"
    icon="i-lucide-server"
    color="neutral"
    variant="subtle"
    title="Measure what a page loads when it's rendered"
  >
    <template #description>
      A page's initial load counts what its route imports statically, not the lazy components it renders on the server. Pass the URLs to render, and each page here lists them with their HTML size and the chunks their HTML preloads:
      <code class="mt-2 block font-mono text-xs text-highlighted">npx nuxt-bundle-analyzer --urls=/,/blog/hello-world</code>
    </template>
  </UAlert>
</template>
