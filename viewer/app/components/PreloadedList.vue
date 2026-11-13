<script setup lang="ts">
import type { Metric, PreloadedFile } from '~/utils/data'
import { chunkKindLabels, formatBytes } from '~/utils/data'

const props = defineProps<{
  files: PreloadedFile[]
  metric: Metric
  /** The color of the bars, such as the one the list's heading names. */
  barClass?: string
  /** The size the bars measure against, such as the URL's initial load. Defaults to the whole list. */
  scale?: number
}>()

const emit = defineEmits<{
  openChunk: [file: string]
}>()

/** A long list, such as the lazy components of a docs page, shows its largest chunks until asked for all. */
const LIMIT = 8
const showAll = ref(false)
// Largest first in the size shown, as compression can reorder files.
const sorted = computed(() => [...props.files].sort((a, b) => b[props.metric] - a[props.metric]))
const shown = computed(() => showAll.value
  ? sorted.value
  : sorted.value.slice(0, LIMIT))
const total = computed(() => props.scale || props.files.reduce((sum, file) => sum + file[props.metric], 0) || 1)
const share = (file: PreloadedFile) => `${Math.max(1, Math.round(file[props.metric] / total.value * 100))}%`
</script>

<template>
  <ul class="space-y-1.5">
    <li v-for="file in shown" :key="file.file">
      <div class="flex items-baseline justify-between gap-3 text-sm">
        <!-- A stylesheet on its own is not a chunk the Chunks view lists. -->
        <component :is="file.chunk ? 'button' : 'span'" class="flex min-w-0 items-center gap-2 text-left" :class="{ 'hover:text-primary': file.chunk }" @click="file.chunk && emit('openChunk', file.file)">
          <UBadge :label="file.chunk ? chunkKindLabels[file.chunk.kind] : 'CSS'" color="neutral" variant="subtle" size="sm" />
          <FileIcon v-if="file.chunk?.src" :path="file.chunk.src" class="size-3.5" />
          <span class="truncate font-mono text-xs">{{ file.chunk?.src ?? file.file.split('/').pop() }}</span>
        </component>
        <span class="shrink-0 text-muted">{{ formatBytes(file[metric]) }}</span>
      </div>
      <div class="mt-1 h-1 rounded-full bg-elevated">
        <div class="h-1 rounded-full" :class="barClass ?? 'bg-primary'" :style="{ width: share(file) }" />
      </div>
    </li>
    <li v-if="files.length > LIMIT && !showAll">
      <button class="text-sm text-muted hover:text-primary" @click="showAll = true">
        And {{ files.length - LIMIT === 1 ? '1 more chunk' : `${files.length - LIMIT} more chunks` }}
      </button>
    </li>
  </ul>
</template>
