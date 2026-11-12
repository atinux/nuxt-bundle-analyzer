<script setup lang="ts">
import type { ChunkInfo, Metric } from '~/utils/data'
import { chunkKindLabels, formatBytes } from '~/utils/data'

const props = defineProps<{
  chunks: ChunkInfo[]
  metric: Metric
  /** The size the bars measure against, such as the page's size. Defaults to the whole list. */
  scale?: number
}>()

const emit = defineEmits<{
  openChunk: [file: string]
}>()

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
        <button class="flex min-w-0 items-center gap-2 text-left hover:text-primary" @click="emit('openChunk', chunk.file)">
          <UBadge :label="chunkKindLabels[chunk.kind]" color="neutral" variant="subtle" size="sm" />
          <FileIcon v-if="chunk.src" :path="chunk.src" class="size-3.5" />
          <span class="truncate font-mono text-xs">{{ chunk.src ?? chunk.file.split('/').pop() }}</span>
        </button>
        <span class="shrink-0 text-muted">{{ formatBytes(size(chunk)) }}</span>
      </div>
      <div class="mt-1 h-1 rounded-full bg-elevated">
        <div class="h-1 rounded-full bg-primary" :style="{ width: share(chunk) }" />
      </div>
    </li>
  </ul>
</template>
