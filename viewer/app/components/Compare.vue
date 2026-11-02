<script setup lang="ts">
import type { Env, Metric, RunData, Source, Target } from '~/utils/data'
import { formatBytes, formatDelta, routeSize } from '~/utils/data'

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
}>()

const groupBy = ref<'package' | 'module'>('package')

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

  <UCard v-if="routes.length" :ui="{ header: 'py-3 sm:px-4', body: 'p-0 sm:p-0' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        Initial Load per Route
      </h3>
      <p class="text-sm text-muted">
        JavaScript and CSS loaded before each route renders.
      </p>
    </template>
    <!-- Narrow screens scroll the table sideways rather than squeezing its figures. -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-muted">
          <tr class="border-b border-default">
            <th class="px-4 py-2 text-left font-medium">
              Route
            </th>
            <th class="px-4 py-2 text-right font-medium">
              {{ base.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium">
              {{ current.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in routes" :key="row.key" class="border-b border-default last:border-0">
            <td class="px-4 py-2">
              <button v-if="row.current !== undefined" class="font-mono text-xs text-left hover:text-primary hover:underline" :title="`Show the modules ${row.key} loads`" @click="emit('openRoute', row.key)">
                {{ row.key }}
              </button>
              <code v-else class="text-xs">{{ row.key }}</code>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              {{ row.base === undefined ? '—' : formatBytes(row.base) }}
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              {{ row.current === undefined ? '—' : formatBytes(row.current) }}
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <UBadge v-if="row.status === 'added' || row.status === 'removed'" :label="row.status === 'added' ? 'New Route' : 'Removed'" color="neutral" variant="subtle" />
              <span v-else :class="deltaClass(row.delta)">{{ formatDelta(row.delta) }}{{ percent(row.delta, row.base ?? 0) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>

  <UCard :ui="{ header: 'py-3 sm:px-4 flex items-center justify-between gap-2', body: 'p-0 sm:p-0' }">
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
    <!-- Narrow screens scroll the table sideways rather than squeezing its figures. -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-muted">
          <tr class="border-b border-default">
            <th class="px-4 py-2 text-left font-medium">
              Path
            </th>
            <th class="px-4 py-2 text-right font-medium">
              {{ base.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium">
              {{ current.run.name }}
            </th>
            <th class="px-4 py-2 text-right font-medium">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" class="border-b border-default last:border-0">
            <td class="px-4 py-2">
              <div class="flex items-center gap-2">
                <button v-if="row.target" class="font-mono text-xs text-left break-all hover:text-primary hover:underline" :title="`Show details of ${row.key}`" @click="emit('inspect', row.target)">
                  {{ row.key }}
                </button>
                <code v-else class="text-xs break-all">{{ row.key }}</code>
                <UBadge v-if="row.status === 'added'" label="Added" color="error" variant="subtle" size="sm" />
                <UBadge v-else-if="row.status === 'removed'" label="Removed" color="success" variant="subtle" size="sm" />
              </div>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              {{ row.base === undefined ? '—' : formatBytes(row.base) }}
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              {{ row.current === undefined ? '—' : formatBytes(row.current) }}
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap" :class="deltaClass(row.delta)">
              {{ formatDelta(row.delta) }}
            </td>
          </tr>
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
