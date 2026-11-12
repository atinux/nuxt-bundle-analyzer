<script setup lang="ts">
import type { Metric, PreloadedFile, PrerenderedInfo } from '~/utils/data'
import { formatBytes, formatDelta } from '~/utils/data'

const props = defineProps<{
  pages: PrerenderedInfo[]
  metric: Metric
  search: string
  /** The largest initial load of the page list, so both views draw their bars to the same scale. */
  largest: number
}>()

const emit = defineEmits<{
  openChunk: [file: string]
}>()

const expanded = ref(new Set<string>())
function toggle(url: string) {
  expanded.value.has(url)
    ? expanded.value.delete(url)
    : expanded.value.add(url)
}

const shown = computed(() => {
  const query = props.search.trim().toLowerCase()
  return query
    ? props.pages.filter(page => [
        page.url,
        page.route?.path,
        page.page?.src,
        ...page.files.map(file => file.chunk?.src ?? file.file),
      ].some(text => text?.toLowerCase().includes(query)))
    : props.pages
})

function largestBy(size: (page: PrerenderedInfo) => number) {
  return props.pages.reduce<PrerenderedInfo | undefined>((largest, page) => !largest || size(page) > size(largest)
    ? page
    : largest, undefined)
}
const largestLoad = computed(() => largestBy(page => page.initial[props.metric]))
const mostAdded = computed(() => largestBy(page => page.addedSize[props.metric]))
const scale = computed(() => Math.max(1, props.largest, ...props.pages.map(page => page.initial[props.metric])))

function chunkCount(files: PreloadedFile[]) {
  return files.length === 1
    ? '1 chunk'
    : `${files.length} chunks`
}
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div class="rounded-lg px-4 py-3 ring ring-default">
      <p class="text-xs text-muted">
        Largest Initial Load
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatBytes(largestLoad?.initial[metric] ?? 0) }}
      </p>
      <p class="truncate text-xs text-muted">
        <span class="font-mono">{{ largestLoad?.url }}</span>, measured from its HTML
      </p>
    </div>
    <div class="rounded-lg px-4 py-3 ring ring-default">
      <p class="text-xs text-muted">
        Most Added Over Its Route
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatDelta(mostAdded?.addedSize[metric] ?? 0) }}
      </p>
      <p class="truncate text-xs text-muted">
        <template v-if="mostAdded?.added.length">
          <span class="font-mono">{{ mostAdded.url }}</span>, {{ chunkCount(mostAdded.added) }} of lazy-loaded components it renders
        </template>
        <template v-else>
          No URL preloads more than its route
        </template>
      </p>
    </div>
  </div>

  <div class="rounded-lg ring ring-default">
    <!-- The columns are named once here rather than on every row. -->
    <div class="flex items-center gap-4 border-b border-default bg-elevated/50 px-4 py-2 text-xs text-muted" aria-hidden="true">
      <span class="w-4 shrink-0" />
      <span class="flex-1">{{ pages.length === 1 ? '1 Prerendered URL' : `${pages.length} Prerendered URLs` }}</span>
      <span class="hidden items-center gap-1.5 lg:flex"><span class="size-2 rounded-xs bg-primary" />From its route</span>
      <span class="hidden items-center gap-1.5 lg:flex"><span class="size-2 rounded-xs bg-warning" />Added by the rendered page</span>
      <span class="hidden w-20 shrink-0 text-right sm:block">HTML</span>
      <span class="w-32 shrink-0 text-right sm:w-48">Initial Load</span>
    </div>
    <ul class="divide-y divide-default">
      <li v-for="page in shown" :key="page.url">
        <button class="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-elevated/50" :aria-expanded="expanded.has(page.url)" @click="toggle(page.url)">
          <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-90': expanded.has(page.url) }" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-mono text-sm text-highlighted">
              {{ page.url }}
            </p>
            <p v-if="page.route" class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <span class="shrink-0 font-mono">{{ page.route.path }}</span>
              <template v-if="page.page?.src">
                ·
                <FileIcon :path="page.page.src" class="size-3.5" />
                <span class="truncate font-mono">{{ page.page.src }}</span>
              </template>
            </p>
            <p v-else class="truncate text-xs text-muted">
              No route's page is in its HTML
            </p>
          </div>
          <div class="hidden w-20 shrink-0 text-right sm:block">
            <p class="text-sm text-highlighted">
              <span class="sr-only">HTML </span>{{ formatBytes(page.html[metric]) }}
            </p>
          </div>
          <div class="w-32 shrink-0 text-right sm:w-48">
            <p class="text-sm text-highlighted">
              <span class="sr-only">Initial load </span>{{ formatBytes(page.initial[metric]) }}
            </p>
            <div class="mt-1 h-1 rounded-full bg-elevated">
              <div class="ms-auto flex h-1 overflow-hidden rounded-full" :style="{ width: `${Math.round(page.initial[metric] / scale * 100)}%` }">
                <div class="h-1 bg-warning" :style="{ width: `${page.initial[metric] ? page.addedSize[metric] / page.initial[metric] * 100 : 0}%` }" />
                <div class="h-1 flex-1" :class="page.route ? 'bg-primary' : 'bg-accented'" />
              </div>
            </div>
          </div>
        </button>

        <div v-if="expanded.has(page.url)" class="space-y-6 border-t border-default px-4 py-4 sm:ps-12">
          <template v-if="page.route">
            <section>
              <h4 class="mb-2 text-sm text-highlighted">
                From Its Route
              </h4>
              <div class="flex items-baseline justify-between gap-3 text-sm">
                <button class="flex min-w-0 items-center gap-2 text-left hover:text-primary" @click="page.page && emit('openChunk', page.page.file)">
                  <UBadge label="Page" color="neutral" variant="subtle" size="sm" />
                  <FileIcon v-if="page.page?.src" :path="page.page.src" class="size-3.5" />
                  <span class="truncate font-mono text-xs">{{ page.page?.src }}</span>
                  <span class="shrink-0 font-mono text-xs text-muted">{{ page.route.path }}</span>
                </button>
                <span class="shrink-0 text-muted">{{ formatBytes(page.routeInitial?.[metric] ?? 0) }}</span>
              </div>
            </section>

            <section>
              <div class="flex items-baseline justify-between gap-3">
                <h4 class="text-sm text-highlighted">
                  Added by the Rendered Page
                </h4>
                <span v-if="page.added.length" class="shrink-0 text-sm text-muted">{{ formatDelta(page.addedSize[metric]) }} in {{ chunkCount(page.added) }}</span>
              </div>
              <p class="mt-1 mb-2 text-xs text-muted">
                Lazy-loaded components the page rendered: its HTML preloads them, but the route's static imports don't reach them.
              </p>
              <PreloadedList v-if="page.added.length" :files="page.added" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
              <p v-else class="text-sm text-muted">
                Its HTML preloads nothing beyond its route.
              </p>
            </section>

            <section v-if="page.notLoaded.length">
              <div class="flex items-baseline justify-between gap-3">
                <h4 class="text-sm text-highlighted">
                  Not Loaded by the HTML
                </h4>
                <span class="shrink-0 text-sm text-muted">{{ formatDelta(-page.notLoaded.reduce((sum, file) => sum + file[metric], 0)) }} in {{ chunkCount(page.notLoaded) }}</span>
              </div>
              <p class="mt-1 mb-2 text-xs text-muted">
                Files its route's static imports reach that its HTML doesn't preload, such as a stylesheet Nuxt inlined in the HTML or a layout picked at runtime.
              </p>
              <PreloadedList :files="page.notLoaded" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
            </section>
          </template>

          <section v-else>
            <h4 class="text-sm text-highlighted">
              Preloaded by Its HTML
            </h4>
            <p class="mt-1 mb-2 text-xs text-muted">
              Its HTML loads no route's page chunk, as for an SPA shell, so it has no route to compare with.
            </p>
            <PreloadedList :files="page.files" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
          </section>
        </div>
      </li>
      <li v-if="shown.length === 0" class="px-4 py-6 text-center text-sm text-muted">
        No URLs match this search. Clear it to see every URL.
      </li>
    </ul>
  </div>
</template>
