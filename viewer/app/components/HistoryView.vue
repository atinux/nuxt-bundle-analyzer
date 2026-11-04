<script setup lang="ts">
import type { Env, Metric, Run } from '~/utils/data'
import { formatBytes, formatDelta } from '~/utils/data'

const props = defineProps<{
  /** One run for each commit, newest first. */
  runs: Run[]
  env: Env
  metric: Metric
  search: string
  /** The repository on GitHub, such as `nuxt/nuxt.com`, to link each commit to. */
  repository: string
}>()

const emit = defineEmits<{
  /** Compare a commit with the one before it. */
  compare: [sha: string]
}>()

interface Point {
  run: Run
  sha: string
  short: string
  message: string
  size?: number
  /** What the commit changed since the commit before it in the history. */
  delta?: number
  previous?: Run
}

const envLabel = computed(() => props.env === 'client'
  ? 'Client'
  : 'Nitro')

/** Every commit, oldest first, with its size and what it changed in the build and size shown. */
const points = computed<Point[]>(() => {
  const chronological = [...props.runs].reverse()
  return chronological.map((run, index) => {
    const previous = chronological[index - 1]
    const size = run.commit?.sizes[props.env]?.[props.metric]
    const before = previous?.commit?.sizes[props.env]?.[props.metric]
    return {
      run,
      sha: run.slug,
      short: run.name,
      message: run.commit?.message ?? '',
      size,
      delta: size !== undefined && before !== undefined
        ? size - before
        : undefined,
      previous,
    }
  })
})
const sized = computed(() => points.value.filter(point => point.size !== undefined))
const first = computed(() => sized.value[0])
const last = computed(() => sized.value.at(-1))

const chartData = computed(() => sized.value.map(point => ({ commit: point.short, size: point.size! })))
const byShort = computed(() => new Map(points.value.map(point => [point.short, point])))
/** The commit under the pointer or the keyboard focus, which the tooltip describes. */
const focused = shallowRef<Point>()
function onFocus(point: { datum: { x?: unknown } } | null) {
  focused.value = point
    ? byShort.value.get(String(point.datum.x))
    : undefined
}
function onSelect(point: { datum: { x?: unknown } } | null) {
  const selected = point && byShort.value.get(String(point.datum.x))
  if (selected?.previous) {
    emit('compare', selected.sha)
  }
}

const order = ref<'newest' | 'change'>('newest')
const rows = computed(() => {
  const query = props.search.trim().toLowerCase()
  const matching = points.value.filter(point => !query || point.sha.startsWith(query) || point.message.toLowerCase().includes(query))
  return (order.value === 'newest'
    ? matching.reverse()
    : matching.filter(point => point.delta).sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
  ).slice(0, 500)
})

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
  return ` (${delta > 0
    ? '+'
    : '−'}${value < 0.05
    ? '<0.1'
    : value.toFixed(1)}%)`
}
function commitUrl(sha: string) {
  return `https://github.com/${props.repository}/commit/${sha}`
}
function date(run: Run) {
  return new Date(run.endTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div v-if="first && last" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
    <div class="rounded-lg ring ring-default px-4 py-3">
      <p class="text-xs text-muted">
        {{ first.short }} · {{ date(first.run) }} · {{ envLabel }}
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatBytes(first.size!) }}
      </p>
    </div>
    <div class="rounded-lg ring ring-default px-4 py-3">
      <p class="text-xs text-muted">
        {{ last.short }} · {{ date(last.run) }} · {{ envLabel }}
      </p>
      <p class="text-xl font-semibold text-highlighted">
        {{ formatBytes(last.size!) }}
      </p>
    </div>
    <div class="rounded-lg ring ring-default px-4 py-3">
      <p class="text-xs text-muted">
        Over {{ sized.length }} {{ sized.length === 1 ? 'commit' : 'commits' }}
      </p>
      <p class="text-xl font-semibold" :class="deltaClass(last.size! - first.size!)">
        {{ formatDelta(last.size! - first.size!) }}<span class="text-sm font-normal">{{ percent(last.size! - first.size!, first.size!) }}</span>
      </p>
    </div>
  </div>

  <UCard v-if="sized.length > 1" :ui="{ header: 'py-3 sm:px-4', body: 'sm:px-4' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        {{ envLabel }} Bundle per Commit
      </h3>
      <p class="text-sm text-muted">
        Every output file of the build, after each commit. Click a commit to see what it changed.
      </p>
    </template>
    <UChart
      :data="chartData"
      index="commit"
      :categories="[{ key: 'size', label: envLabel }]"
      :format="formatBytes"
      :x-axis="false"
      :points="sized.length <= 60"
      :height="240"
      :aria-label="`${envLabel} bundle size per commit`"
      class="cursor-pointer"
      @focus-change="onFocus"
      @select="onSelect"
    >
      <template #tooltip>
        <div v-if="focused" class="max-w-72 space-y-0.5 text-xs">
          <p class="text-muted">
            <span class="font-mono">{{ focused.short }}</span> · {{ date(focused.run) }}
          </p>
          <p class="line-clamp-2 text-highlighted">
            {{ focused.message }}
          </p>
          <p>
            {{ formatBytes(focused.size!) }}
            <span v-if="focused.delta !== undefined" :class="deltaClass(focused.delta)">
              {{ formatDelta(focused.delta) }}
            </span>
          </p>
        </div>
      </template>
    </UChart>
  </UCard>

  <UCard :ui="{ header: 'py-3 sm:px-4 flex items-center justify-between gap-2', body: 'p-0 sm:p-0' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        Commits
      </h3>
      <UTabs
        v-model="order"
        :items="[{ label: 'Newest', value: 'newest' }, { label: 'Largest Change', value: 'change' }]"
        :content="false"
        size="xs"
      />
    </template>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-muted">
          <tr class="border-b border-default">
            <th class="px-4 py-2 text-left font-medium">
              Commit
            </th>
            <th class="px-4 py-2 text-right font-medium max-sm:hidden">
              Size
            </th>
            <th class="px-4 py-2 text-right font-medium">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.sha" class="border-b border-default last:border-0">
            <!-- The message takes the room left and truncates, so phones keep the change in view. -->
            <td class="w-full max-w-0 px-4 py-2">
              <div class="flex items-center gap-2">
                <ULink :to="commitUrl(row.sha)" target="_blank" class="shrink-0 font-mono text-xs text-muted hover:text-highlighted" :aria-label="`Commit ${row.short} on GitHub`">
                  {{ row.short }}
                </ULink>
                <span class="min-w-0 flex-1 truncate" :title="row.message">{{ row.message || '—' }}</span>
                <span class="shrink-0 text-xs text-muted max-md:hidden">{{ date(row.run) }}</span>
              </div>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap max-sm:hidden">
              {{ row.size === undefined ? '—' : formatBytes(row.size) }}
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button
                v-if="row.previous && row.delta !== undefined"
                class="hover:underline"
                :class="deltaClass(row.delta)"
                :title="`Compare ${row.short} with ${row.previous.name}`"
                @click="emit('compare', row.sha)"
              >
                {{ formatDelta(row.delta) }}
              </button>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="3" class="px-4 py-6 text-center text-muted">
              {{ search ? 'No commit matches the search.' : 'No commit changed the size yet.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
