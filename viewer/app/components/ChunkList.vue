<script setup lang="ts">
import type { ChunkInfo, Metric, Target } from '~/utils/data'
import { chunkKindLabels, formatBytes } from '~/utils/data'

const props = defineProps<{
  chunks: ChunkInfo[]
  metric: Metric
  /** The size the bars measure against, such as the page's size. Defaults to the whole list. */
  scale?: number
  /** Each row opens to the files and packages in its chunk, rather than opening the chunk in Chunks. */
  expandable?: boolean
}>()

const emit = defineEmits<{
  openChunk: [file: string]
  inspect: [target: Target]
}>()

const expanded = ref(new Set<string>())
function open(chunk: ChunkInfo) {
  if (!props.expandable) {
    emit('openChunk', chunk.file)
    return
  }
  expanded.value.has(chunk.file)
    ? expanded.value.delete(chunk.file)
    : expanded.value.add(chunk.file)
}

function size(chunk: ChunkInfo) {
  return chunk[props.metric] + chunk.css[props.metric]
}

// Largest first, so what takes the space comes first.
const sorted = computed(() => [...props.chunks].sort((a, b) => size(b) - size(a)))
const total = computed(() => props.scale || props.chunks.reduce((sum, chunk) => sum + size(chunk), 0) || 1)
const share = (chunk: ChunkInfo) => `${Math.max(1, Math.round(size(chunk) / total.value * 100))}%`
</script>

<template>
  <ul class="space-y-1.5">
    <li v-for="chunk in sorted" :key="chunk.file">
      <div class="flex items-baseline justify-between gap-3 text-sm">
        <button class="flex min-w-0 items-center gap-2 text-left hover:text-primary" :aria-expanded="expandable ? expanded.has(chunk.file) : undefined" @click="open(chunk)">
          <UIcon v-if="expandable" name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-90': expanded.has(chunk.file) }" />
          <UBadge :label="chunkKindLabels[chunk.kind]" color="neutral" variant="subtle" size="sm" />
          <FileIcon v-if="chunk.src" :path="chunk.src" class="size-3.5" />
          <span class="truncate font-mono text-xs">{{ chunk.src ?? chunk.file.split('/').pop() }}</span>
        </button>
        <span class="shrink-0 text-muted">{{ formatBytes(size(chunk)) }}</span>
      </div>
      <div class="mt-1 h-1 rounded-full bg-elevated">
        <div class="h-1 rounded-full bg-primary" :style="{ width: share(chunk) }" />
      </div>
      <div v-if="expanded.has(chunk.file)" class="mt-3 mb-4 space-y-3 ps-6">
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
  </ul>
</template>
