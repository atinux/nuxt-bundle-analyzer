<script setup lang="ts">
import type { ChunkInfo, Metric, PageInfo, PrerenderedInfo, Target } from '~/utils/data'
import { chunkKindLabels, formatBytes, pagesDir } from '~/utils/data'

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

const everyPage = computed(() => props.chunks.filter(chunk => chunk.loadedBy === 'all'))
const everyPageSize = computed(() => everyPage.value.reduce((sum, chunk) => sum + chunk[props.metric] + chunk.css[props.metric], 0))
const largest = computed(() => Math.max(1, ...props.pages.map(page => page.initial?.[props.metric] ?? 0)))

function chunkName(chunk: ChunkInfo) {
  return chunk.file.split('/').pop()
}
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <button class="rounded-lg px-4 py-3 text-left ring ring-default hover:bg-elevated/50" @click="emit('openChunk', everyPage[0]?.file ?? '')">
      <p class="flex items-center justify-between gap-2 text-xs text-muted">
        Loaded on Every Page
        <span class="flex shrink-0 items-center gap-1"><span class="hidden lg:inline">Show Chunks</span><UIcon name="i-lucide-arrow-right" class="size-3.5" /></span>
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatBytes(everyPageSize) }}
      </p>
      <p class="text-xs text-muted">
        {{ everyPage.length }} chunks, from the app entry
      </p>
    </button>
    <div class="rounded-lg px-4 py-3 ring ring-default">
      <p class="text-xs text-muted">
        Largest Initial Load
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatBytes(largest) }}
      </p>
    </div>
  </div>

  <div class="rounded-lg ring ring-default">
    <!-- The columns are named once here rather than on every row. -->
    <div class="flex items-center gap-4 border-b border-default bg-elevated/50 px-4 py-2 text-xs text-muted" aria-hidden="true">
      <span class="w-4 shrink-0" />
      <span class="flex-1">{{ pages.length === 1 ? '1 Page' : `${pages.length} Pages` }}</span>
      <span class="hidden w-28 shrink-0 text-right sm:block">Page Chunk</span>
      <span class="w-32 shrink-0 text-right sm:w-48">Initial Load</span>
    </div>
    <ul class="divide-y divide-default">
      <li v-for="page in shown" :key="page.file">
        <button class="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-elevated/50" :aria-expanded="expanded.has(page.file)" @click="toggle(page.file)">
          <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-90': expanded.has(page.file) }" />
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 font-mono text-sm text-highlighted">
              <FileIcon :path="page.file" class="size-4" />
              <!-- Narrow screens leave out the pages directory every page shares, so the file name fits. -->
              <span class="truncate"><span class="max-sm:hidden">{{ pagesDir(page.file) }}</span>{{ page.file.slice(pagesDir(page.file).length) }}</span>
            </p>
            <p class="truncate ps-6 text-xs text-muted">
              <span v-if="page.route" class="font-mono">{{ page.route }}</span>
              <template v-else>
                Parent of <span class="font-mono">{{ page.routes.join(', ') }}</span>
              </template>
              <span v-if="urlsByPage.get(page.file)!.length" class="text-primary"> · {{ urlsByPage.get(page.file)!.length === 1 ? '1 prerendered URL' : `${urlsByPage.get(page.file)!.length} prerendered URLs` }}</span>
            </p>
          </div>
          <div class="hidden w-28 shrink-0 text-right sm:block">
            <p class="text-sm text-highlighted">
              <span class="sr-only">Page chunk </span>{{ formatBytes(page.chunk[metric] + page.chunk.css[metric]) }}
            </p>
          </div>
          <div class="w-32 shrink-0 text-right sm:w-48">
            <template v-if="page.initial">
              <p class="text-sm text-highlighted">
                <span class="sr-only">Initial load </span>{{ formatBytes(page.initial[metric]) }}
              </p>
            </template>
            <p v-else class="text-sm text-muted">
              In its child routes
            </p>
          </div>
        </button>

        <div v-if="expanded.has(page.file)" class="space-y-6 border-t border-default px-4 py-4 sm:ps-12">
          <ChunkContents :parts="page.chunk.contents" :metric="metric" @inspect="target => emit('inspect', target)" />

          <section v-if="page.loads.length">
            <h4 class="mb-2 text-sm text-highlighted">
              Also Loaded Before It Renders
            </h4>
            <ul class="space-y-1">
              <li v-for="chunk in page.loads" :key="chunk.file" class="flex items-baseline justify-between gap-3 text-sm">
                <button class="flex min-w-0 items-center gap-2 text-left hover:text-primary" @click="emit('openChunk', chunk.file)">
                  <UBadge :label="chunkKindLabels[chunk.kind]" color="neutral" variant="subtle" size="sm" />
                  <FileIcon v-if="chunk.src" :path="chunk.src" class="size-3.5" />
                  <span class="truncate font-mono text-xs">{{ chunk.src ?? chunkName(chunk) }}</span>
                </button>
                <span class="shrink-0 text-muted">{{ formatBytes(chunk[metric] + chunk.css[metric]) }}</span>
              </li>
            </ul>
          </section>

          <section v-if="page.lazy.length">
            <h4 class="mb-2 text-sm text-highlighted">
              Loaded on Demand
            </h4>
            <ul class="space-y-1">
              <li v-for="chunk in page.lazy" :key="chunk.file" class="flex items-baseline justify-between gap-3 text-sm">
                <button class="flex min-w-0 items-center gap-2 text-left hover:text-primary" @click="emit('openChunk', chunk.file)">
                  <UBadge :label="chunkKindLabels[chunk.kind]" color="neutral" variant="subtle" size="sm" />
                  <FileIcon v-if="chunk.src" :path="chunk.src" class="size-3.5" />
                  <span class="truncate font-mono text-xs">{{ chunk.src ?? chunkName(chunk) }}</span>
                </button>
                <span class="shrink-0 text-muted">{{ formatBytes(chunk[metric] + chunk.css[metric]) }}</span>
              </li>
            </ul>
          </section>

          <section v-if="urlsByPage.get(page.file)!.length">
            <h4 class="text-sm text-highlighted">
              Prerendered URLs
            </h4>
            <p class="mt-1 mb-2 text-xs text-muted">
              What each URL's HTML preloads: {{ page.initial ? `this route's ${formatBytes(page.initial[metric])}` : 'its route' }}, plus the lazy-loaded components the page rendered, minus any route files the HTML doesn't load, such as stylesheets Nuxt inlines.
            </p>
            <PrerenderedUrls :urls="urlsByPage.get(page.file)!" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
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
    <PrerenderedUrls :urls="shownOtherUrls" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
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
