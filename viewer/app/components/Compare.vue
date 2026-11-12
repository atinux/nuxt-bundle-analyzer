<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { ChunkInfo, Env, Metric, RunData, Source, Target } from '~/utils/data'
import { clientChunks, formatBytes, formatDelta, locationChanges, pageChanges, pages, pagesDir, prerenderedSize, routeChanges, routeSize, serverChunks } from '~/utils/data'

const props = defineProps<{
  base: RunData
  current: RunData
  env: Env
  metric: Metric
  search: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
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
  /** The page a route renders, whose row shows it to open its details. */
  page?: string
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

/** The page file each route renders, which its row shows to open the page's details. */
const pageFiles = computed(() => {
  const files = new Map<string, string>()
  if (props.env !== 'client') {
    return files
  }
  // The base run first, so a route it has and the current run dropped still shows the page it
  // rendered, and the panel can describe it from that run.
  for (const data of [props.base, props.current]) {
    for (const page of pages(data, chunksOf(data))) {
      for (const route of page.routes) {
        files.set(route, page.file)
      }
    }
  }
  return files
})

/** Every route of both runs, the largest difference first, before the search. */
const allRoutes = computed<Row[]>(() => {
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
  return paths
    .map(path => ({
      ...toRow(path, sizeOf(props.base, path), sizeOf(props.current, path)),
      page: pageFiles.value.get(path),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
})

/** The table picked, one at a time so a long list of routes does not push the packages out of reach. */
const pickedTable = ref<'routes' | 'packages'>('routes')
/** The table shown, which is always the packages one for Nitro, as it has no routes. */
const table = computed(() => allRoutes.value.length
  ? pickedTable.value
  : 'packages')
/** Every prerendered URL of both runs, with the difference of its HTML, the largest difference first. */
const allUrls = computed(() => {
  if (props.env !== 'client') {
    return []
  }
  const sizesOf = (data: RunData) => new Map(data.prerendered.map(page => [
    page.url,
    {
      initial: prerenderedSize(data, page)[props.metric],
      html: props.metric === 'uncompressed'
        ? page.size
        : page[props.metric],
    },
  ]))
  const before = sizesOf(props.base)
  const after = sizesOf(props.current)
  return [
    ...new Set([
      ...before.keys(),
      ...after.keys(),
    ]),
  ]
    .map(url => ({
      ...toRow(url, before.get(url)?.initial, after.get(url)?.initial),
      html: (after.get(url)?.html ?? 0) - (before.get(url)?.html ?? 0),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || Math.abs(b.html) - Math.abs(a.html))
})
const urls = computed(() => {
  const query = props.search.trim().toLowerCase()
  return query
    ? allUrls.value.filter(row => row.key.toLowerCase().includes(query))
    : allUrls.value
})

/** The routes the search keeps: its path, or the page file that renders it. */
const routes = computed(() => {
  const query = props.search.trim().toLowerCase()
  return query
    ? allRoutes.value.filter(row => [row.key, row.page].some(text => text?.toLowerCase().includes(query)))
    : allRoutes.value
})

/** Every file or package that changed and the search keeps, the largest difference first. */
const changes = computed<Row[]>(() => {
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
})
const rows = computed(() => changes.value.slice(0, 500))

/** The tables to pick, with how many rows the search keeps in each. */
const tableItems = computed<TabsItem[]>(() => [
  { label: 'Routes', value: 'routes', badge: routes.value.length },
  { label: 'Packages', value: 'packages', badge: changes.value.length },
])

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
const urlDetails = computed(() => Object.fromEntries([...expanded.value]
  .filter(key => key.startsWith('url:'))
  .map(key => [
    key.slice('url:'.length),
    pageChanges(props.base, props.current, key.slice('url:'.length), props.metric),
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
    <UTabs
      v-if="show === 'tables' && allRoutes.length"
      v-model="pickedTable"
      :items="tableItems"
      :content="false"
      size="xs"
    />
    <p v-else class="text-sm text-muted">
      {{ show === 'tables'
        ? 'Where the difference is, by package or module.'
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

  <UCard v-if="show === 'tables' && table === 'routes'" :ui="{ header: 'py-3 sm:px-4', body: 'p-0 sm:p-0' }">
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
            <!-- The whole row opens the route's changes, as a page or a chunk row does. -->
            <tr class="cursor-pointer border-b border-default last:border-0" @click="toggle(`route:${row.key}`)">
              <td class="px-4 py-2">
                <div class="flex min-w-32 items-center gap-2">
                  <UButton
                    :icon="expanded.has(`route:${row.key}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-expanded="expanded.has(`route:${row.key}`)"
                    :aria-label="`Show where the difference of ${row.key} comes from`"
                    @click.stop="toggle(`route:${row.key}`)"
                  />
                  <span class="min-w-0">
                    <span class="block font-mono text-xs break-all">{{ row.key }}</span>
                    <!-- The page it renders opens its details, as the name of a package does. -->
                    <button v-if="row.page" class="flex max-w-full items-center gap-1.5 font-mono text-xs text-muted hover:text-primary hover:underline" :title="`Show details of ${row.page}`" @click.stop="emit('inspect', { kind: 'file', id: row.page })">
                      <FileIcon :path="row.page" class="size-3.5 shrink-0" />
                      <!-- Narrow screens leave out the pages directory, as Pages does, so the row fits. -->
                      <span class="wrap-anywhere"><span class="max-sm:hidden">{{ pagesDir(row.page) }}</span>{{ row.page.slice(pagesDir(row.page).length) }}</span>
                    </button>
                  </span>
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
          <tr v-if="!routes.length">
            <td colspan="4" class="px-4 py-6 text-center text-muted">
              No routes match this search.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>

  <UCard v-if="show === 'tables' && (table === 'routes' || !allRoutes.length) && allUrls.length" :ui="{ header: 'py-3 sm:px-4', body: 'p-0 sm:p-0' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        Initial Load per Prerendered URL
      </h3>
      <p class="text-sm text-muted">
        JavaScript and CSS each URL's prerendered HTML preloads, and the difference of the HTML itself.
      </p>
    </template>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-muted">
          <tr class="border-b border-default">
            <th class="px-4 py-2 text-left font-medium">
              URL
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
            <th class="px-4 py-2 text-right font-medium max-sm:hidden">
              HTML
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in urls" :key="row.key">
            <tr class="cursor-pointer border-b border-default last:border-0" @click="toggle(`url:${row.key}`)">
              <td class="px-4 py-2">
                <div class="flex min-w-32 items-center gap-2">
                  <UButton
                    :icon="expanded.has(`url:${row.key}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-expanded="expanded.has(`url:${row.key}`)"
                    :aria-label="`Show where the difference of ${row.key} comes from`"
                    @click.stop="toggle(`url:${row.key}`)"
                  />
                  <span class="min-w-0 font-mono text-xs break-all">{{ row.key }}</span>
                </div>
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden">
                {{ row.base === undefined ? '—' : formatBytes(row.base) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden">
                {{ row.current === undefined ? '—' : formatBytes(row.current) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap">
                <UBadge v-if="row.status === 'added' || row.status === 'removed'" :label="row.status === 'added' ? 'New URL' : 'Removed'" color="neutral" variant="subtle" />
                <span v-else :class="deltaClass(row.delta)">{{ formatDelta(row.delta) }}{{ percent(row.delta, row.base ?? 0) }}</span>
                <!-- Phones have no HTML column, so the difference of the HTML goes under this one. -->
                <span v-if="row.status === 'changed' || row.status === 'same'" class="block text-xs sm:hidden" :class="deltaClass(row.html)">HTML {{ formatDelta(row.html) }}</span>
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden" :class="row.status === 'changed' || row.status === 'same' ? deltaClass(row.html) : 'text-muted'">
                {{ row.status === 'changed' || row.status === 'same' ? formatDelta(row.html) : '—' }}
              </td>
            </tr>
            <tr v-if="expanded.has(`url:${row.key}`)" class="border-b border-default bg-elevated/30 last:border-0">
              <td colspan="5" class="px-4 py-4 sm:ps-13">
                <div v-if="urlDetails[row.key]" class="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <ChangeList
                    title="Chunks It Loads"
                    :changes="urlDetails[row.key]!.chunks"
                    :base-name="base.run.name"
                    :current-name="current.run.name"
                    :notes="loadedBy"
                    empty="The chunks it loads did not change."
                  />
                  <ChangeList
                    title="Files and Packages in Them"
                    :changes="urlDetails[row.key]!.sources"
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
          <tr v-if="!urls.length">
            <td colspan="5" class="px-4 py-6 text-center text-muted">
              No URLs match this search.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>

  <UCard v-if="show === 'tables' && table === 'packages'" :ui="{ header: 'py-3 sm:px-4 flex items-center justify-between gap-2', body: 'p-0 sm:p-0' }">
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
