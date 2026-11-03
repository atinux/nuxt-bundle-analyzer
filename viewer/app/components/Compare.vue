<script setup lang="ts">
import type { ChunkInfo, Env, Metric, RunData, Source, Target } from '~/utils/data'
import { clientChunks, formatBytes, formatDelta, locationChanges, routeChanges, routeSize, serverChunks } from '~/utils/data'

const props = defineProps<{
  base: RunData
  current: RunData
  env: Env
  metric: Metric
  search: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
  /** Show the page a route renders in the current run. */
  openRoute: [path: string]
  openChunk: [file: string]
}>()

const groupBy = ref<'package' | 'module'>('package')
/** The tables of what changed, or the same changes on the city of the chunks. */
const show = ref<'tables' | 'city'>('tables')
function chunksOf(data: RunData) {
  return props.env === 'client'
    ? clientChunks(data)
    : serverChunks(data)
}
const cityChunks = computed(() => show.value === 'city'
  ? {
      base: chunksOf(props.base),
      current: chunksOf(props.current),
    }
  : undefined)

const totals = computed(() => ({
  base: props.base.bundles[props.env]?.[props.metric] ?? 0,
  current: props.current.bundles[props.env]?.[props.metric] ?? 0,
}))

interface Row {
  key: string
  base?: number
  current?: number
  delta: number
  status: 'added' | 'removed' | 'changed' | 'same'
  /** The file or package the row is about, to show its details. */
  target?: Target
}

function toRow(key: string, base: number | undefined, current: number | undefined): Row {
  return {
    key,
    base,
    current,
    delta: (current ?? 0) - (base ?? 0),
    status: base === undefined
      ? 'added'
      : current === undefined
        ? 'removed'
        : base === current
          ? 'same'
          : 'changed',
  }
}

const routes = computed<Row[]>(() => {
  if (props.env !== 'client') {
    return []
  }
  const sizeOf = (data: RunData, path: string) => {
    const route = data.routes.find(route => route.path === path)
    return route && routeSize(data, route)[props.metric]
  }
  const paths = [
    ...new Set([
      ...props.current.routes,
      ...props.base.routes,
    ].map(route => route.path)),
  ]
  return paths.map(path => toRow(path, sizeOf(props.base, path), sizeOf(props.current, path)))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
})

const rows = computed<Row[]>(() => {
  const isPackage = groupBy.value === 'package'
  const keyOf = (source: Source) => isPackage && source.package
    ? `node_modules/${source.package}`
    : source.id
  const sizes = new Map<string, { base?: number, current?: number }>()
  const add = (sources: Source[] | undefined, side: 'base' | 'current') => {
    for (const source of sources ?? []) {
      const row = sizes.get(keyOf(source)) ?? {}
      row[side] = (row[side] ?? 0) + source[props.metric]
      sizes.set(keyOf(source), row)
    }
  }
  add(props.base.bundles[props.env]?.sources, 'base')
  add(props.current.bundles[props.env]?.sources, 'current')
  const query = props.search.trim().toLowerCase()
  return [...sizes]
    .map(([key, { base, current }]) => {
      const row = toRow(key, base, current)
      // Code Sonda could not trace to a source, `[unassigned]`, has no details to show.
      if (!key.startsWith('[')) {
        // Grouped, a dependency's key is its package, as `node_modules/<name>`.
        row.target = isPackage && key.startsWith('node_modules/')
          ? {
              kind: 'package',
              id: key.slice('node_modules/'.length),
            }
          : { kind: 'file', id: key }
      }
      return row
    })
    .filter(row => row.status !== 'same' && (!query || row.key.toLowerCase().includes(query)))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 500)
})

// Rows open to show where their difference comes from.
const expanded = ref(new Set<string>())
function toggle(key: string) {
  expanded.value.has(key)
    ? expanded.value.delete(key)
    : expanded.value.add(key)
}

/** Where the difference of each open route comes from. */
const routeDetails = computed(() => Object.fromEntries([...expanded.value]
  .filter(key => key.startsWith('route:'))
  .map(key => [
    key.slice('route:'.length),
    routeChanges(props.base, props.current, key.slice('route:'.length), props.metric),
  ])))

/** When each client chunk loads, from the current run, or the base one for a chunk it no longer has. */
const loadedBy = computed(() => {
  if (props.env !== 'client') {
    return {}
  }
  const label = (chunk: ChunkInfo) => chunk.loadedBy === 'all'
    ? 'Loaded on every page'
    : chunk.loadedBy === 'lazy'
      ? 'Loaded on demand'
      : `Loaded before ${chunk.loadedBy?.join(', ')} renders`
  return Object.fromEntries([
    ...clientChunks(props.base),
    ...clientChunks(props.current),
  ].map(chunk => [
    chunk.file,
    label(chunk),
  ]))
})

const envLabel = computed(() => props.env === 'client'
  ? 'Client'
  : 'Nitro')

function deltaClass(delta: number) {
  return delta > 0
    ? 'text-error'
    : delta < 0
      ? 'text-success'
      : 'text-muted'
}
function percent(delta: number, base: number) {
  if (!base || !delta) {
    return ''
  }
  const value = Math.abs(delta / base * 100)
  // The same minus sign as `formatDelta`, and no `0.0%` for a change too small to round.
  return ` (${delta > 0
    ? '+'
    : '−'}${value < 0.05
    ? '<0.1'
    : value.toFixed(1)}%)`
}
</script>

<template>
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
    <div class="rounded-lg ring ring-default px-4 py-3">
      <p class="text-xs text-muted">
        {{ base.run.name }} · {{ envLabel }}
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatBytes(totals.base) }}
      </p>
    </div>
    <div class="rounded-lg ring ring-default px-4 py-3">
      <p class="text-xs text-muted">
        {{ current.run.name }} · {{ envLabel }}
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatBytes(totals.current) }}
      </p>
    </div>
    <div class="rounded-lg ring ring-default px-4 py-3">
      <p class="text-xs text-muted">
        Difference
      </p>
      <p class="text-xl font-semibold" :class="deltaClass(totals.current - totals.base)">
        {{ formatDelta(totals.current - totals.base) }}<span class="text-sm font-normal">{{ percent(totals.current - totals.base, totals.base) }}</span>
      </p>
    </div>
  </div>

  <div class="flex items-center justify-between gap-3">
    <p class="text-sm text-muted">
      {{ show === 'tables'
        ? 'Where the difference is, by route and by package or module.'
        : `The chunks of ${current.run.name}, each file or package colored by how it changed since ${base.run.name}. Drag to turn, scroll to zoom.` }}
    </p>
    <UTabs
      v-model="show"
      :items="[{ label: 'Tables', value: 'tables' }, { label: '3D', value: 'city' }]"
      :content="false"
      size="xs"
    />
  </div>

  <LazyChunksCity
    v-if="cityChunks"
    :chunks="cityChunks.current"
    :base="cityChunks.base"
    :env="env"
    :metric="metric"
    :search="search"
    @inspect="target => emit('inspect', target)"
    @open-chunk="file => emit('openChunk', file)"
  />

  <UCard v-if="show === 'tables' && routes.length" :ui="{ header: 'py-3 sm:px-4', body: 'p-0 sm:p-0' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        Initial Load per Route
      </h3>
      <p class="text-sm text-muted">
        JavaScript and CSS loaded before each route renders.
      </p>
    </template>
    <!-- Phones keep the difference and leave both sizes to the details; anything wider still scrolls sideways. -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-muted">
          <tr class="border-b border-default">
            <th class="px-4 py-2 text-left font-medium">
              Route
            </th>
            <th class="px-4 py-2 text-right font-medium max-sm:hidden">
              {{ base.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium max-sm:hidden">
              {{ current.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in routes" :key="row.key">
            <tr class="border-b border-default last:border-0">
              <td class="px-4 py-2">
                <div class="flex min-w-32 items-center gap-2">
                  <UButton
                    :icon="expanded.has(`route:${row.key}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-expanded="expanded.has(`route:${row.key}`)"
                    :aria-label="`Show where the difference of ${row.key} comes from`"
                    @click="toggle(`route:${row.key}`)"
                  />
                  <button v-if="row.current !== undefined" class="font-mono text-xs text-left break-all hover:text-primary hover:underline" :title="`Show the page of ${row.key}`" @click="emit('openRoute', row.key)">
                    {{ row.key }}
                  </button>
                  <code v-else class="text-xs break-all">{{ row.key }}</code>
                </div>
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden">
                {{ row.base === undefined ? '—' : formatBytes(row.base) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden">
                {{ row.current === undefined ? '—' : formatBytes(row.current) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap">
                <UBadge v-if="row.status === 'added' || row.status === 'removed'" :label="row.status === 'added' ? 'New Route' : 'Removed'" color="neutral" variant="subtle" />
                <span v-else :class="deltaClass(row.delta)">{{ formatDelta(row.delta) }}{{ percent(row.delta, row.base ?? 0) }}</span>
              </td>
            </tr>
            <tr v-if="expanded.has(`route:${row.key}`)" class="border-b border-default bg-elevated/30 last:border-0">
              <td colspan="4" class="px-4 py-4 sm:ps-13">
                <div v-if="routeDetails[row.key]" class="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <ChangeList
                    title="Chunks It Loads"
                    :changes="routeDetails[row.key]!.chunks"
                    :base-name="base.run.name"
                    :current-name="current.run.name"
                    :notes="loadedBy"
                    empty="The chunks it loads did not change."
                  />
                  <ChangeList
                    title="Files and Packages in Them"
                    :changes="routeDetails[row.key]!.sources"
                    :base-name="base.run.name"
                    :current-name="current.run.name"
                    sources
                    empty="No file or package in them changed."
                    @inspect="target => emit('inspect', target)"
                  />
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </UCard>

  <UCard v-if="show === 'tables'" :ui="{ header: 'py-3 sm:px-4 flex items-center justify-between gap-2', body: 'p-0 sm:p-0' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        Changed {{ groupBy === 'package' ? 'Packages and Modules' : 'Modules' }}
      </h3>
      <UTabs
        v-model="groupBy"
        :items="[{ label: 'Group Packages', value: 'package' }, { label: 'Every Module', value: 'module' }]"
        :content="false"
        size="xs"
      />
    </template>
    <!-- Phones keep the difference and leave both sizes to the details; anything wider still scrolls sideways. -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-muted">
          <tr class="border-b border-default">
            <th class="px-4 py-2 text-left font-medium">
              Path
            </th>
            <th class="px-4 py-2 text-right font-medium max-sm:hidden">
              {{ base.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium max-sm:hidden">
              {{ current.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in rows" :key="row.key">
            <tr class="border-b border-default last:border-0">
              <td class="px-4 py-2">
                <!-- The path keeps room to read, and narrow screens scroll the table instead of squeezing it. -->
                <div class="flex min-w-48 items-center gap-2">
                  <UButton
                    v-if="row.target"
                    :icon="expanded.has(`row:${row.key}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-expanded="expanded.has(`row:${row.key}`)"
                    :aria-label="`Show where the difference of ${row.key} comes from`"
                    @click="toggle(`row:${row.key}`)"
                  />
                  <span v-else class="w-6 shrink-0" />
                  <span class="min-w-0">
                    <button v-if="row.target" class="font-mono text-xs text-left break-all hover:text-primary hover:underline" :title="`Show details of ${row.key}`" @click="emit('inspect', row.target)">
                      {{ row.key }}
                    </button>
                    <code v-else class="text-xs break-all">{{ row.key }}</code>
                    <UBadge v-if="row.status === 'added'" label="Added" color="error" variant="subtle" size="sm" class="ms-1.5 align-middle" />
                    <UBadge v-else-if="row.status === 'removed'" label="Removed" color="success" variant="subtle" size="sm" class="ms-1.5 align-middle" />
                  </span>
                </div>
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden">
                {{ row.base === undefined ? '—' : formatBytes(row.base) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden">
                {{ row.current === undefined ? '—' : formatBytes(row.current) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap" :class="deltaClass(row.delta)">
                {{ formatDelta(row.delta) }}
              </td>
            </tr>
            <tr v-if="row.target && expanded.has(`row:${row.key}`)" class="border-b border-default bg-elevated/30 last:border-0">
              <td colspan="4" class="px-4 py-4 sm:ps-13">
                <ChangeList
                  title="In Chunks"
                  :changes="locationChanges(base, current, env, row.target, metric)"
                  :base-name="base.run.name"
                  :current-name="current.run.name"
                  :notes="loadedBy"
                  empty="It is in the same chunks, with the same size in each."
                />
              </td>
            </tr>
          </template>
          <tr v-if="rows.length === 0">
            <td colspan="4" class="px-4 py-6 text-center text-muted">
              No differences in the {{ envLabel }} bundle.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
