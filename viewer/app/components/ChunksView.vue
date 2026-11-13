<script setup lang="ts">
import type { ChunkInfo, Env, Metric, Target } from '~/utils/data'
import { chunkKindLabels, formatBytes, sourceKind } from '~/utils/data'

const props = defineProps<{
  chunks: ChunkInfo[]
  /** Which build the chunks are from. */
  env: Env
  metric: Metric
  search: string
  /** A chunk to show expanded, such as one picked in the Pages view. */
  focus?: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
}>()

const groupBy = ref<'chunk' | 'file' | 'city'>('chunk')
const expanded = ref(new Set<string>())
function toggle(file: string) {
  expanded.value.has(file)
    ? expanded.value.delete(file)
    : expanded.value.add(file)
}
/** Shows a chunk expanded in the By Chunk list. */
async function showChunk(file: string) {
  groupBy.value = 'chunk'
  expanded.value.add(file)
  await nextTick()
  document.getElementById(`chunk-${file}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
watch(() => props.focus, file => file && showChunk(file), { immediate: true })

const query = computed(() => props.search.trim().toLowerCase())
const matches = (texts: (string | undefined)[]) => !query.value || texts.some(text => text?.toLowerCase().includes(query.value))

const shownChunks = computed(() => props.chunks
  .filter(chunk => matches([
    chunk.file,
    chunk.src,
    ...chunk.contents.map(part => part.id),
  ]))
  .sort((a, b) => b[props.metric] - a[props.metric]))

function loadedBy(chunk: ChunkInfo) {
  if (!chunk.loadedBy) {
    return undefined
  }
  if (chunk.loadedBy === 'all') {
    return 'Every page'
  }
  if (chunk.loadedBy === 'lazy') {
    return 'On demand'
  }
  return chunk.loadedBy.join(', ')
}

/**
 * A chunk's name: the file it was split for, or the project files in it, with the file whose icon
 * shows next to it. A chunk made only of dependencies, such as Vue's runtime, is named after them.
 */
function describe(chunk: ChunkInfo): { text: string, file?: string } | undefined {
  if (chunk.src) {
    return { text: chunk.src, file: chunk.src }
  }
  const list = (names: string[]) => names.slice(0, 3).join(', ') + (names.length > 3
    ? ` and ${names.length - 3} more`
    : '')
  const files = chunk.contents.filter(part => sourceKind(part) === 'component' || sourceKind(part) === 'file').map(part => part.id.split('/').pop()!)
  if (files.length) {
    return {
      text: list(files),
      file: files[0],
    }
  }
  const packages = [
    ...new Set(chunk.contents.flatMap(part => part.package
      ? [part.package]
      : [])),
  ]
  return packages.length
    ? {
        text: list(packages),
      }
    : undefined
}
const subtitles = computed(() => new Map(shownChunks.value.map(chunk => [
  chunk.file,
  describe(chunk),
])))

interface FileRow {
  id: string
  size: number
  chunks: ChunkInfo[]
}

// By file: every file of the project with the chunks it ends up in, grouped by directory.
const folders = computed(() => {
  const files = new Map<string, FileRow>()
  for (const chunk of props.chunks) {
    for (const part of chunk.contents) {
      const kind = sourceKind(part)
      if (kind !== 'component' && kind !== 'file') {
        continue
      }
      const file = files.get(part.id) ?? { id: part.id, size: 0, chunks: [] }
      file.size += part[props.metric]
      file.chunks.push(chunk)
      files.set(part.id, file)
    }
  }
  const groups = new Map<string, FileRow[]>()
  for (const file of [
    ...files.values(),
  ].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!matches([
      file.id,
      ...file.chunks.map(chunk => chunk.file),
    ])) {
      continue
    }
    const folder = file.id.includes('/')
      ? file.id.slice(0, file.id.lastIndexOf('/') + 1)
      : './'
    groups.set(folder, [
      ...groups.get(folder) ?? [],
      file,
    ])
  }
  return [...groups].map(([folder, files]) => ({ folder, files }))
})

function fileLoadedBy(file: FileRow) {
  if (file.chunks.every(chunk => !chunk.loadedBy)) {
    return undefined
  }
  if (file.chunks.some(chunk => chunk.loadedBy === 'all')) {
    return 'Every page'
  }
  const routes = new Set(file.chunks.flatMap(chunk => Array.isArray(chunk.loadedBy)
    ? chunk.loadedBy
    : []))
  return routes.size
    ? [...routes].join(', ')
    : 'On demand'
}
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <p class="text-sm text-muted">
      {{ groupBy === 'chunk'
        ? `Every JavaScript file of the ${env === 'client' ? 'client' : 'Nitro server'} build, and the files and dependencies in it.`
        : groupBy === 'file'
          ? 'Every file of your project, and the chunks it ends up in.'
          : 'Each chunk is a plot, and each file or package in it a building. Drag to turn, scroll to zoom.' }}
    </p>
    <UTabs
      v-model="groupBy"
      :items="[{ label: 'By Chunk', value: 'chunk' }, { label: 'By File', value: 'file' }, { label: '3D', value: 'city' }]"
      :content="false"
      size="xs"
    />
  </div>

  <ul v-if="groupBy === 'chunk'" class="divide-y divide-default rounded-lg ring ring-default">
    <li v-for="chunk in shownChunks" :id="`chunk-${chunk.file}`" :key="chunk.file" class="scroll-mt-4">
      <button class="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-elevated/50" :aria-expanded="expanded.has(chunk.file)" @click="toggle(chunk.file)">
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-90': expanded.has(chunk.file) }" />
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2">
            <span class="truncate font-mono text-sm text-highlighted">{{ chunk.file.split('/').pop() }}</span>
            <UBadge :label="chunkKindLabels[chunk.kind]" :color="chunk.kind === 'entry' ? 'primary' : 'neutral'" variant="subtle" size="sm" />
          </p>
          <p v-if="subtitles.get(chunk.file)" class="flex items-center gap-1.5 font-mono text-xs text-muted">
            <FileIcon v-if="subtitles.get(chunk.file)?.file" :path="subtitles.get(chunk.file)!.file!" class="size-3.5" />
            <UIcon v-else name="i-vscode-icons-file-type-npm" class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ subtitles.get(chunk.file)?.text }}</span>
          </p>
        </div>
        <p v-if="loadedBy(chunk)" class="hidden w-56 shrink-0 truncate text-right text-xs text-muted md:block" :title="loadedBy(chunk)">
          {{ loadedBy(chunk) }}
        </p>
        <div class="w-28 shrink-0 text-right">
          <p class="text-sm text-highlighted">
            {{ formatBytes(chunk[metric]) }}
          </p>
          <p v-if="chunk.css[metric]" class="text-xs text-muted">
            + {{ formatBytes(chunk.css[metric]) }} CSS
          </p>
        </div>
      </button>
      <div v-if="expanded.has(chunk.file)" class="border-t border-default px-4 py-4 sm:ps-12">
        <ChunkContents :parts="chunk.contents" :chunk="chunk.file" :metric="metric" @inspect="target => emit('inspect', target)" />
      </div>
    </li>
    <li v-if="shownChunks.length === 0" class="px-4 py-6 text-center text-sm text-muted">
      No chunks match this search. Clear it to see every chunk.
    </li>
  </ul>

  <!-- Three.js only loads with this view. -->
  <LazyChunksCity
    v-else-if="groupBy === 'city'"
    :chunks="chunks"
    :env="env"
    :metric="metric"
    :search="search"
    @inspect="target => emit('inspect', target)"
    @open-chunk="showChunk"
  />

  <div v-else class="rounded-lg ring ring-default">
    <section v-for="group in folders" :key="group.folder" class="border-b border-default last:border-0">
      <h4 class="bg-elevated/50 px-4 py-2 font-mono text-xs text-highlighted">
        {{ group.folder }}
      </h4>
      <ul class="divide-y divide-default">
        <li v-for="file in group.files" :key="file.id" class="flex items-center gap-4 px-4 py-2">
          <button class="flex min-w-0 flex-1 items-center gap-2 text-left font-mono text-sm hover:text-primary hover:underline" :title="`Show details of ${file.id}`" @click="emit('inspect', { kind: 'file', id: file.id })">
            <FileIcon :path="file.id" class="size-4" />
            <span class="truncate">{{ file.id.slice(group.folder.length) }}</span>
          </button>
          <div class="flex shrink-0 flex-wrap justify-end gap-1">
            <UBadge
              v-for="chunk in file.chunks"
              :key="chunk.file"
              as="button"
              :label="chunk.file.split('/').pop()"
              color="neutral"
              variant="outline"
              size="sm"
              class="font-mono hover:bg-elevated"
              :title="`Show ${chunk.file.split('/').pop()} in By Chunk`"
              @click="showChunk(chunk.file)"
            />
          </div>
          <p v-if="fileLoadedBy(file)" class="hidden w-40 shrink-0 truncate text-right text-xs text-muted md:block">
            {{ fileLoadedBy(file) }}
          </p>
          <span class="w-20 shrink-0 text-right text-sm text-muted">{{ formatBytes(file.size) }}</span>
        </li>
      </ul>
    </section>
    <p v-if="folders.length === 0" class="px-4 py-6 text-center text-sm text-muted">
      No files match this search. Clear it to see every file.
    </p>
  </div>
</template>
