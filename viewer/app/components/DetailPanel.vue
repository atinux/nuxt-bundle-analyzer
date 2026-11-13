<script setup lang="ts">
import type { Bundle, ChunkInfo, Env, ImportKind, Metric, Part, Target } from '~/utils/data'
import { chunkKindLabels, formatBytes, importChain, sourceKind } from '~/utils/data'

const props = defineProps<{
  /** What to show; the panel is closed without one. */
  target?: Target
  bundle?: Bundle
  /** The chunks of the same build as `bundle`. */
  chunks: ChunkInfo[]
  env: Env
  metric: Metric
  /** The run the details come from, when it is not the one picked, such as for a removed file. */
  otherRun?: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
  openChunk: [file: string]
  close: []
}>()

// Kept while the panel closes, so its contents do not disappear before it does.
const shown = ref<Target>()
watch(() => props.target, (target) => {
  if (target) {
    shown.value = target
  }
}, { immediate: true })

function matches(part: Pick<Part, 'id' | 'package'>) {
  return shown.value?.kind === 'package'
    ? part.package === shown.value.id
    : part.id === shown.value?.id
}

/** The chunk a package was picked in, such as a page's, whose files of the package are the ones shown. */
const scope = computed(() => shown.value?.kind === 'package' && shown.value.chunk
  ? props.chunks.find(chunk => chunk.file === shown.value!.chunk)
  : undefined)
const sources = computed(() => scope.value
  ? scope.value.contents.filter(matches)
  : props.bundle?.sources.filter(matches) ?? [])
const size = computed(() => sources.value.reduce((sum, source) => sum + source[props.metric], 0))
const buildSize = computed(() => (props.bundle?.sources.filter(matches) ?? []).reduce((sum, source) => sum + source[props.metric], 0))
const scopeName = computed(() => scope.value?.file.split('/').pop())

const inChunks = computed(() => props.chunks
  .map(chunk => ({
    chunk,
    size: chunk.contents.filter(matches).reduce((sum, part) => sum + part[props.metric], 0),
  }))
  .filter(entry => entry.size > 0)
  .sort((a, b) => b.size - a.size))

const loadedBy = computed(() => {
  const chunks = inChunks.value.map(entry => entry.chunk)
  if (props.env !== 'client' || chunks.length === 0) {
    return undefined
  }
  if (chunks.some(chunk => chunk.loadedBy === 'all')) {
    return 'Every page'
  }
  const routes = new Set(chunks.flatMap(chunk => Array.isArray(chunk.loadedBy)
    ? chunk.loadedBy
    : []))
  return routes.size
    ? [...routes].join(', ')
    : 'On demand'
})

/** A package's files, largest first; a file is a list of one. */
const files = computed(() => [...sources.value].sort((a, b) => b[props.metric] - a[props.metric]))

/** What imports the file, or the package from outside of it. */
const importers = computed(() => {
  const found = new Map<string, ImportKind>()
  const ids = shown.value?.kind === 'package'
    ? files.value.map(file => file.id)
    : [shown.value?.id ?? '']
  for (const id of ids) {
    for (const [importer, kind] of props.bundle?.importers.get(id) ?? []) {
      if (shown.value?.kind === 'package' && importer.startsWith(`node_modules/${shown.value.id}/`)) {
        continue
      }
      if (found.get(importer) !== 'import') {
        found.set(importer, kind)
      }
    }
  }
  return [...found].map(([id, kind]) => ({ id, kind })).sort((a, b) => a.id.localeCompare(b.id))
})

/** How the build gets to the file; for a package, to the one of its files with the best chain. */
const chain = computed(() => {
  if (!props.bundle || !shown.value) {
    return []
  }
  const ids = shown.value.kind === 'package'
    ? files.value.map(file => file.id)
    : [shown.value.id]
  const chains = ids.map(id => importChain(props.bundle!, id)).filter(chain => chain.length > 0)
  const onDemand = (chain: typeof chains[number]) => chain.filter(step => step.kind === 'dynamic-import').length
  return chains.sort((a, b) => onDemand(a) - onDemand(b) || a.length - b.length)[0] ?? []
})

const duplicates = computed(() => shown.value?.kind === 'package'
  ? props.bundle?.duplicates.get(shown.value.id)
  : undefined)

/** The output chunk the panel shows, such as one a page loads. */
const shownChunk = computed(() => shown.value?.kind === 'chunk'
  ? props.chunks.find(other => other.file === shown.value!.id)
  : undefined)
const chunkLoadedBy = computed(() => {
  const loadedBy = shownChunk.value?.loadedBy
  return loadedBy === 'all'
    ? 'Every page'
    : loadedBy === 'lazy'
      ? 'On demand'
      : loadedBy?.join(', ')
})

const description = computed(() => {
  if (!shown.value) {
    return ''
  }
  const build = props.env === 'client'
    ? 'Client'
    : 'Nitro'
  if (shown.value.kind === 'chunk') {
    return shownChunk.value
      ? `${chunkKindLabels[shownChunk.value.kind]} Chunk · ${build}`
      : `Chunk · ${build}`
  }
  if (shown.value.kind === 'package') {
    return scope.value
      ? `Dependency · ${build} · In ${scopeName.value}`
      : `Dependency · ${build}`
  }
  const kind = sourceKind({ id: shown.value.id, package: sources.value[0]?.package })
  const labels = {
    component: 'Your Component',
    file: 'Your File',
    dependency: `From ${sources.value[0]?.package}`,
    nuxt: 'Generated by Nuxt',
  }
  return `${labels[kind]} · ${build}`
})
</script>

<template>
  <USlideover
    :open="!!target"
    :title="shown?.kind === 'chunk' ? shown.id.split('/').pop() : shown?.id"
    :description="description"
    :ui="{ content: 'sm:max-w-xl', title: 'font-mono text-sm break-all', body: 'tabular-nums space-y-6' }"
    @update:open="open => !open && emit('close')"
  >
    <template #body>
      <template v-if="shown?.kind === 'chunk'">
        <template v-if="shownChunk">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg px-4 py-3 ring ring-default">
              <p class="text-xs text-muted">
                Size
              </p>
              <p class="text-xl font-semibold text-highlighted">
                {{ formatBytes(shownChunk[metric] + shownChunk.css[metric]) }}
              </p>
              <p class="text-xs text-muted">
                {{ shownChunk.css[metric] ? `With ${formatBytes(shownChunk.css[metric])} of CSS` : 'JavaScript only' }}
              </p>
            </div>
            <div v-if="chunkLoadedBy" class="rounded-lg px-4 py-3 ring ring-default">
              <p class="text-xs text-muted">
                Loaded By
              </p>
              <p class="truncate text-sm text-highlighted" :title="chunkLoadedBy">
                {{ chunkLoadedBy }}
              </p>
            </div>
          </div>
          <p v-if="shownChunk.src" class="flex items-center gap-1.5 font-mono text-xs text-muted">
            <FileIcon :path="shownChunk.src" class="size-3.5" />
            <span class="truncate">{{ shownChunk.src }}</span>
          </p>
          <ChunkContents :parts="shownChunk.contents" :chunk="shownChunk.file" :metric="metric" @inspect="target => emit('inspect', target)" />
          <button class="flex items-center gap-1 text-xs text-muted hover:text-primary" @click="emit('openChunk', shownChunk.file)">
            Show in Chunks
            <UIcon name="i-lucide-arrow-right" class="size-3.5" />
          </button>
        </template>
        <p v-else class="text-sm text-muted">
          This build has no such shownChunk.
        </p>
      </template>

      <template v-else>
        <UAlert v-if="otherRun" color="neutral" variant="subtle" icon="i-lucide-info" :description="`Not in the picked run. These details are from ${otherRun}.`" />

        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-lg px-4 py-3 ring ring-default">
            <p class="truncate text-xs text-muted">
              {{ scope ? `Size in ${scopeName}` : 'Size in This Build' }}
            </p>
            <p class="text-xl font-semibold text-highlighted">
              {{ formatBytes(size) }}
            </p>
            <p class="text-xs text-muted">
              <template v-if="scope">
                {{ files.length === 1 ? '1 file' : `${files.length} files` }}, of {{ formatBytes(buildSize) }} in the build
              </template>
              <template v-else>
                {{ inChunks.length === 1 ? 'In 1 chunk' : `In ${inChunks.length} chunks` }}
              </template>
            </p>
          </div>
          <div v-if="loadedBy" class="rounded-lg px-4 py-3 ring ring-default">
            <p class="text-xs text-muted">
              Loaded By
            </p>
            <p class="truncate text-sm text-highlighted" :title="loadedBy">
              {{ loadedBy }}
            </p>
          </div>
        </div>

        <!-- Picked in a chunk, such as a page's, so it matches the files and size listed there. -->
        <p v-if="scope && shown" class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>Only its files in <span class="font-mono">{{ scopeName }}</span>.</span>
          <button class="flex items-center gap-1 hover:text-primary" @click="emit('inspect', { kind: 'package', id: shown.id })">
            Show it across the build
            <UIcon name="i-lucide-arrow-right" class="size-3.5" />
          </button>
        </p>

        <section v-if="duplicates">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-copy"
            :title="`Bundled from ${duplicates.length} locations`"
            description="Usually because two versions are installed. A copy with code in the output adds it again."
            class="mb-3"
          />
          <PackageCopies :copies="duplicates" :metric="metric" @inspect="target => emit('inspect', target)" />
        </section>

        <section v-if="shown?.kind === 'package'">
          <h3 class="mb-2 text-sm text-highlighted">
            Files
          </h3>
          <ul class="space-y-1">
            <li v-for="file in files" :key="file.id" class="flex items-center justify-between gap-3 text-sm">
              <button class="flex min-w-0 items-center gap-1.5 text-left font-mono text-xs hover:text-primary hover:underline" :title="`Show details of ${file.id}`" @click="emit('inspect', { kind: 'file', id: file.id })">
                <FileIcon :path="file.id" class="size-3.5" />
                <span class="truncate">{{ file.id.slice(`node_modules/${shown.id}/`.length) }}</span>
              </button>
              <span class="shrink-0 text-muted">{{ formatBytes(file[metric]) }}</span>
            </li>
          </ul>
        </section>

        <section>
          <h3 class="mb-2 text-sm text-highlighted">
            In Chunks
          </h3>
          <ul v-if="inChunks.length" class="space-y-1">
            <li v-for="{ chunk, size: share } in inChunks" :key="chunk.file" class="flex items-center justify-between gap-3 text-sm">
              <button class="flex min-w-0 items-center gap-2 text-left hover:text-primary" :title="`Show ${chunk.file} in Chunks`" @click="emit('openChunk', chunk.file)">
                <span class="truncate font-mono text-xs">{{ chunk.file.split('/').pop() }}</span>
                <UBadge :label="chunkKindLabels[chunk.kind]" color="neutral" variant="subtle" size="sm" />
              </button>
              <span class="shrink-0 text-muted">{{ formatBytes(share) }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">
            In no chunk of this build.
          </p>
        </section>

        <section>
          <h3 class="text-sm text-highlighted">
            Why It’s Included
          </h3>
          <p class="mb-2 text-xs text-muted">
            The imports that lead here, with as few loaded on demand as possible.
          </p>
          <ol v-if="chain.length > 1" class="space-y-1">
            <li v-for="(step, index) in chain" :key="step.id" class="flex items-center gap-1.5 text-xs">
              <UIcon v-if="index > 0" name="i-lucide-corner-down-right" class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
              <button
                class="flex min-w-0 items-center gap-1.5 text-left font-mono hover:text-primary hover:underline"
                :class="{ 'text-highlighted': index === chain.length - 1 }"
                :title="`Show details of ${step.id}`"
                @click="emit('inspect', { kind: 'file', id: step.id })"
              >
                <FileIcon :path="step.id" class="size-3.5" />
                <span class="truncate">{{ step.id }}</span>
              </button>
              <UBadge v-if="step.kind === 'dynamic-import'" label="On Demand" color="neutral" variant="outline" size="sm" class="shrink-0" />
            </li>
          </ol>
          <p v-else class="text-sm text-muted">
            {{ chain[0] && bundle?.entries.has(chain[0].id) ? 'Nothing imports it: it starts its chunk.' : 'Sonda recorded no imports that lead here.' }}
          </p>
        </section>

        <section>
          <h3 class="mb-2 text-sm text-highlighted">
            Imported By
          </h3>
          <ul v-if="importers.length" class="space-y-1">
            <li v-for="importer in importers" :key="importer.id" class="flex items-center justify-between gap-3 text-xs">
              <button class="flex min-w-0 items-center gap-1.5 text-left font-mono hover:text-primary hover:underline" :title="`Show details of ${importer.id}`" @click="emit('inspect', { kind: 'file', id: importer.id })">
                <FileIcon :path="importer.id" class="size-3.5" />
                <span class="truncate">{{ importer.id }}</span>
              </button>
              <UBadge v-if="importer.kind === 'dynamic-import'" label="On Demand" color="neutral" variant="outline" size="sm" class="shrink-0" />
            </li>
          </ul>
          <p v-else class="text-sm text-muted">
            Sonda recorded nothing that imports it.
          </p>
        </section>
      </template>
    </template>
  </USlideover>
</template>
