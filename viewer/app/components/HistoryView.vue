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

/** How many packages the chart shows apart; the rest of the build is Other. */
const PACKAGES_SHOWN = 12
/** Tailwind's 500 shades, spelled out: Tailwind only defines the color variables a class uses. */
const PACKAGE_COLORS = [
  // red, orange, amber, yellow, lime, emerald, teal, cyan, blue, indigo, violet, pink
  'oklch(63.7% 0.237 25.331)',
  'oklch(70.5% 0.213 47.604)',
  'oklch(76.9% 0.188 70.08)',
  'oklch(79.5% 0.184 86.047)',
  'oklch(76.8% 0.233 130.85)',
  'oklch(69.6% 0.17 162.48)',
  'oklch(70.4% 0.14 182.503)',
  'oklch(71.5% 0.143 215.221)',
  'oklch(62.3% 0.214 259.815)',
  'oklch(58.5% 0.233 277.117)',
  'oklch(60.6% 0.25 292.717)',
  'oklch(65.6% 0.241 354.308)',
]

const hasPackages = computed(() => sized.value.some(point => point.run.commit?.packages?.[props.env]))
const breakdown = ref<'total' | 'packages'>('packages')
const byPackage = computed(() => hasPackages.value && breakdown.value === 'packages')

/** The packages that were the largest after any commit, the smallest first so the largest stacks on top. */
const shownPackages = computed(() => {
  const largest = new Map<string, number>()
  for (const point of sized.value) {
    for (const [name, sizes] of Object.entries(point.run.commit?.packages?.[props.env] ?? {})) {
      largest.set(name, Math.max(largest.get(name) ?? 0, sizes[props.metric]))
    }
  }
  return [...largest].sort((a, b) => b[1] - a[1]).slice(0, PACKAGES_SHOWN).map(([name]) => name).reverse()
})

const categories = computed(() => byPackage.value
  ? [
      { key: 'other', label: 'Other', color: 'var(--ui-bg-accented)' },
      ...shownPackages.value.map((name, index) => ({
        key: `package${index}`,
        label: name,
        color: PACKAGE_COLORS[PACKAGE_COLORS.length - shownPackages.value.length + index],
      })),
    ]
  : [
      { key: 'size', label: envLabel.value },
    ])

const chartData = computed(() => sized.value.map((point) => {
  if (!byPackage.value) {
    return { commit: point.short, size: point.size! }
  }
  const packages = point.run.commit?.packages?.[props.env] ?? {}
  const row: Record<string, string | number> = { commit: point.short }
  // Other is what the shown packages leave of the total, so each bar still adds up to it.
  let other = point.size!
  shownPackages.value.forEach((name, index) => {
    const size = packages[name]?.[props.metric] ?? 0
    row[`package${index}`] = size
    other -= size
  })
  row.other = Math.max(other, 0)
  return row
}))
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

  <UCard v-if="sized.length > 1" :ui="{ header: 'py-3 sm:px-4 flex items-start justify-between gap-2', body: 'sm:px-4' }">
    <template #header>
      <div>
        <h3 class="text-base text-highlighted">
          {{ envLabel }} Bundle per Commit
        </h3>
        <p class="text-sm text-muted">
          {{ byPackage ? `Every output file of the build after each commit, with its ${shownPackages.length} largest packages.` : 'Every output file of the build, after each commit.' }} Click a commit to see what it changed.
        </p>
      </div>
      <UTabs
        v-if="hasPackages"
        v-model="breakdown"
        :items="[{ label: 'By Package', value: 'packages' }, { label: 'Total', value: 'total' }]"
        :content="false"
        size="xs"
        class="shrink-0"
      />
    </template>
    <UChart
      :key="byPackage ? 'packages' : 'total'"
      :type="byPackage ? 'bar' : 'line'"
      :stacked="byPackage"
      :data="chartData"
      index="commit"
      :categories="categories"
      :format="formatBytes"
      :x-axis="false"
      :points="!byPackage && sized.length <= 60"
      :height="byPackage ? 320 : 240"
      :aria-label="byPackage ? `${envLabel} bundle size per commit, by package` : `${envLabel} bundle size per commit`"
      class="cursor-pointer"
      @focus-change="onFocus"
      @select="onSelect"
    >
      <template #tooltip="{ rows: tooltipRows }">
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
          <template v-if="byPackage">
            <!-- The top of the stack first, as the bar reads. -->
            <div v-for="row in [...tooltipRows].reverse()" :key="row.label" class="flex items-center gap-1.5" :class="row.active ? 'text-highlighted' : 'text-muted'">
              <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" />
              <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
              <span class="tabular-nums">{{ row.value }}</span>
            </div>
            <p v-if="!focused.run.commit?.packages?.[env]" class="text-muted">
              Its packages are not recorded yet.
            </p>
          </template>
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
