<script setup lang="ts">
import type { Metric, PrerenderedInfo } from '~/utils/data'
import { formatBytes, formatDelta } from '~/utils/data'

const props = defineProps<{
  urls: PrerenderedInfo[]
  metric: Metric
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

const sorted = computed(() => [...props.urls].sort((a, b) => b.initial[props.metric] - a.initial[props.metric]))

function chunkCount(count: number) {
  return count === 1
    ? '1 chunk'
    : `${count} chunks`
}
</script>

<template>
  <ul class="space-y-1">
    <li v-for="url in sorted" :key="url.url">
      <button class="flex w-full items-baseline gap-3 text-left text-sm hover:text-primary" :aria-expanded="expanded.has(url.url)" @click="toggle(url.url)">
        <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 self-center text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-90': expanded.has(url.url) }" />
        <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ url.url }}</span>
        <span class="hidden shrink-0 text-xs text-muted sm:inline">HTML {{ formatBytes(url.html[metric]) }}</span>
        <!-- Adds up to the initial load: what its HTML preloads from its route, and what the rendered page adds, when it adds any. -->
        <span v-if="url.route && url.added.length" class="hidden shrink-0 text-xs sm:inline">
          <span class="text-primary"><span class="sr-only">From its route </span>{{ formatBytes(url.initial[metric] - url.addedSize[metric]) }}</span>
          <span class="text-muted"> + </span>
          <span class="text-warning"><span class="sr-only">added by the rendered page </span>{{ formatBytes(url.addedSize[metric]) }}</span>
        </span>
        <span class="shrink-0 text-highlighted"><span class="sr-only">Initial load </span>{{ formatBytes(url.initial[metric]) }}</span>
      </button>

      <div v-if="expanded.has(url.url)" class="mt-2 mb-3 space-y-4 ps-6">
        <template v-if="url.route">
          <section>
            <div class="flex items-baseline justify-between gap-3">
              <h5 class="flex items-center gap-1.5 text-xs text-highlighted">
                <span class="size-2 rounded-xs bg-warning" />Added by the Rendered Page
              </h5>
              <span v-if="url.added.length" class="shrink-0 text-xs text-muted">{{ formatDelta(url.addedSize[metric]) }} in {{ chunkCount(url.added.length) }}</span>
            </div>
            <p class="mt-1 mb-2 text-xs text-muted">
              Lazy-loaded components the page rendered: its HTML preloads them, but the route's static imports don't reach them.
            </p>
            <PreloadedList v-if="url.added.length" :files="url.added" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
            <p v-else class="text-xs text-muted">
              Its HTML preloads nothing beyond its route.
            </p>
          </section>

          <section v-if="url.notLoaded.length">
            <div class="flex items-baseline justify-between gap-3">
              <h5 class="text-xs text-highlighted">
                Not Loaded by the HTML
              </h5>
              <span class="shrink-0 text-xs text-muted">{{ formatDelta(-url.notLoaded.reduce((sum, file) => sum + file[metric], 0)) }} in {{ chunkCount(url.notLoaded.length) }}</span>
            </div>
            <p class="mt-1 mb-2 text-xs text-muted">
              Files its route's static imports reach that its HTML doesn't preload, such as a stylesheet Nuxt inlined in the HTML or a layout picked at runtime.
            </p>
            <PreloadedList :files="url.notLoaded" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
          </section>
        </template>

        <section v-else>
          <p class="mb-2 text-xs text-muted">
            Its HTML loads no page's chunk, as for an SPA shell, so this is everything it preloads.
          </p>
          <PreloadedList :files="url.files" :metric="metric" @open-chunk="file => emit('openChunk', file)" />
        </section>
      </div>
    </li>
  </ul>
</template>
