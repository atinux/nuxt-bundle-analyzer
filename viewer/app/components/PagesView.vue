<script setup lang="ts">
import type { ChunkInfo, Metric, PageInfo, Target } from '~/utils/data'
import { chunkKindLabels, formatBytes } from '~/utils/data'

const props = defineProps<{
  pages: PageInfo[]
  chunks: ChunkInfo[]
  metric: Metric
  search: string
  /** A route whose page to show expanded, such as one picked in Compare. */
  focus?: string
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
watch(() => props.focus, async (route) => {
  const page = route && props.pages.find(page => page.route === route)
  if (!page) {
    return
  }
  expanded.value.add(page.file)
  await nextTick()
  document.getElementById(`page-${page.file}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}, { immediate: true })

const shown = computed(() => {
  const query = props.search.trim().toLowerCase()
  return query
    ? props.pages.filter(page => [
        page.file,
        ...page.routes,
        ...page.chunk.contents.map(part => part.id),
      ].some(text => text.toLowerCase().includes(query)))
    : props.pages
})

const everyPage = computed(() => props.chunks.filter(chunk => chunk.loadedBy === 'all'))
const everyPageSize = computed(() => everyPage.value.reduce((sum, chunk) => sum + chunk[props.metric] + chunk.css[props.metric], 0))
const largest = computed(() => Math.max(1, ...props.pages.map(page => page.initial?.[props.metric] ?? 0)))

/** The pages directory a page is in, such as `app/pages/`. */
function pagesDir(file: string) {
  return file.match(/^(?:.*?\/)?pages\//)?.[0] ?? ''
}

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
      <li v-for="page in shown" :id="`page-${page.file}`" :key="page.file" class="scroll-mt-4">
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
              <div class="mt-1 h-1 rounded-full bg-elevated">
                <div class="ms-auto h-1 rounded-full bg-primary" :style="{ width: `${Math.round(page.initial[metric] / largest * 100)}%` }" />
              </div>
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
        </div>
      </li>
      <li v-if="shown.length === 0" class="px-4 py-6 text-center text-sm text-muted">
        No pages match this search. Clear it to see every page.
      </li>
    </ul>
  </div>
</template>
