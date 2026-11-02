<script setup lang="ts">
import type { SelectItem, TabsItem } from '@nuxt/ui'
import type { Env, Metric, Run, RunData, Target } from '~/utils/data'
import { clientChunks, fetchRun, fetchRuns, hostedPull, pages, serverChunks } from '~/utils/data'

type View = 'pages' | 'chunks' | 'issues' | 'compare'
const VIEWS: View[] = ['pages', 'chunks', 'issues', 'compare']

// The whole UI state lives in the URL, so a view can be shared or reloaded.
const params = new URLSearchParams(location.search)
const state = reactive({
  view: (VIEWS.find(view => view === params.get('view')) ?? 'pages') as View,
  run: params.get('run') ?? '',
  base: params.get('base') ?? '',
  env: (params.get('env') === 'nitro'
    ? 'nitro'
    : 'client') as Env,
  // Gzip by default, which is closest to what browsers download.
  metric: (['uncompressed', 'brotli'].includes(params.get('metric') ?? '')
    ? params.get('metric')
    : 'gzip') as Metric,
  search: params.get('q') ?? '',
  /** The file or package the detail panel shows. */
  file: params.get('file') ?? '',
  package: params.get('package') ?? '',
})

watch(state, () => {
  const query = new URLSearchParams()
  const defaults: Record<string, string> = { view: 'pages', env: 'client', metric: 'gzip' }
  for (const [key, value] of Object.entries({ ...state, q: state.search, search: '' })) {
    if (value && value !== defaults[key]) {
      query.set(key, value)
    }
  }
  history.replaceState(null, '', `?${query}`)
}, { deep: true })

const runs = ref<Run[]>([])
const error = ref<string>()
const cache = new Map<string, Promise<RunData>>()
const data = shallowRef<RunData>()
const baseData = shallowRef<RunData>()

function load(slug: string) {
  const run = runs.value.find(run => run.slug === slug)
  if (!run) {
    return Promise.resolve(undefined)
  }
  if (!cache.has(slug)) {
    cache.set(slug, fetchRun(run))
  }
  return cache.get(slug)!
}

/** The pull request the hosted viewer shows, when it is opened from one. */
const pull = hostedPull()
const pullLink = pull && { to: `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.pull}`, label: `${pull.owner}/${pull.repo}#${pull.pull}` }
const loaded = ref(false)

fetchRuns().then((list) => {
  runs.value = list
  loaded.value = true
  if (!list.some(run => run.slug === state.run)) {
    state.run = (list.find(run => run.current) ?? list[0])?.slug ?? ''
  }
  if (!list.some(run => run.slug === state.base)) {
    state.base = list.find(run => run.slug !== state.run)?.slug ?? ''
  }
}).catch((cause) => {
  error.value = String(cause)
})

// Runs load asynchronously, so a run named in the URL is only found once they are there.
watch(() => [state.run, runs.value] as const, async ([slug]) => {
  data.value = await load(slug)
  if (data.value && !data.value.bundles[state.env]) {
    state.env = data.value.bundles.client ? 'client' : 'nitro'
  }
}, { immediate: true })
watch(() => [state.base, runs.value] as const, async ([slug]) => {
  baseData.value = await load(slug)
}, { immediate: true })

/** Pages are about the client build, which Nitro has no equivalent of. */
const env = computed<Env>(() => state.view === 'pages'
  ? 'client'
  : state.env)
function chunksOf(run: RunData | undefined, of: Env) {
  return run
    ? of === 'client'
      ? clientChunks(run)
      : serverChunks(run)
    : []
}
const chunks = computed(() => chunksOf(data.value, env.value))
const pageList = computed(() => data.value
  ? pages(data.value, chunksOf(data.value, 'client'))
  : [])

const focusedChunk = ref<string>()
async function openChunk(file: string) {
  Object.assign(state, {
    view: 'chunks',
    env: env.value,
    file: '',
    package: '',
  })
  // Cleared first, so picking the same chunk again still scrolls to it.
  focusedChunk.value = undefined
  await nextTick()
  focusedChunk.value = file
}
const focusedRoute = ref<string>()
async function openRoute(path: string) {
  state.view = 'pages'
  focusedRoute.value = undefined
  await nextTick()
  focusedRoute.value = path
}

const inspected = computed<Target | undefined>(() => state.package
  ? { kind: 'package', id: state.package }
  : state.file
    ? { kind: 'file', id: state.file }
    : undefined)
function inspect(target: Target) {
  Object.assign(state, target.kind === 'package'
    ? { package: target.id, file: '' }
    : { file: target.id, package: '' })
}
/**
 * The run the panel describes: the picked one, or in Compare the base run for what was removed.
 */
const inspectedData = computed(() => {
  const target = inspected.value
  const has = (run: RunData | undefined) => run?.bundles[env.value]?.sources.some(source => target?.kind === 'package'
    ? source.package === target.id
    : source.id === target?.id)
  return state.view === 'compare' && !has(data.value) && has(baseData.value)
    ? baseData.value
    : data.value
})
const inspectedChunks = computed(() => inspectedData.value === data.value
  ? chunks.value
  : chunksOf(inspectedData.value, env.value))

/** Issues in the build the Issues view shows, which keeps the build picked in another view. */
const issueCount = computed(() => {
  const bundle = data.value?.bundles[state.env]
  return bundle
    ? bundle.duplicates.size + bundle.cycles.length
    : 0
})
const viewItems = computed<TabsItem[]>(() => [
  { label: 'Pages', value: 'pages' },
  { label: 'Chunks', value: 'chunks' },
  { label: 'Issues', value: 'issues', badge: issueCount.value || undefined },
  { label: 'Compare', value: 'compare' },
])
const envItems = computed<TabsItem[]>(() => [
  {
    label: 'Client',
    value: 'client',
    icon: 'i-lucide-monitor',
    disabled: !data.value?.bundles.client,
  },
  {
    label: 'Nitro',
    value: 'nitro',
    icon: 'i-lucide-server',
    disabled: !data.value?.bundles.nitro,
  },
])
const runItems = computed<SelectItem[]>(() => runs.value.map(run => ({
  label: `${run.name}${run.current ? ' (latest)' : ''}`,
  value: run.slug,
  description: new Date(run.endTime).toLocaleString(),
})))
// Raw is the size on disk: minified for the client build, as Nitro writes it for the server.
const metricItems: TabsItem[] = [
  { label: 'Raw', value: 'uncompressed' },
  { label: 'Gzip', value: 'gzip' },
  { label: 'Brotli', value: 'brotli' },
]
</script>

<template>
  <UApp>
    <UDashboardGroup>
      <!-- The body scrolls, so its sections keep their height instead of shrinking to fit it. -->
      <UDashboardPanel id="main" :ui="{ body: 'tabular-nums *:shrink-0' }">
        <template #header>
          <UDashboardNavbar :toggle="false">
            <template #title>
              <img src="/favicon.svg" alt="Nuxt" class="size-6">
              Bundle Analyzer
              <ULink v-if="pullLink" :to="pullLink.to" target="_blank" class="ms-1 font-sans text-sm font-normal text-muted hover:text-highlighted max-sm:hidden">
                {{ pullLink.label }}
              </ULink>
            </template>
            <template #right>
              <UTabs v-model="state.view" :items="viewItems" :content="false" size="xs" class="max-sm:hidden" />
              <UColorModeButton />
            </template>
          </UDashboardNavbar>

          <!-- Narrow screens give the views a row of their own, so the title keeps its room. -->
          <div class="border-b border-default px-4 py-2 sm:hidden">
            <UTabs v-model="state.view" :items="viewItems" :content="false" size="xs" :ui="{ list: 'w-full', trigger: 'flex-1 justify-center' }" />
          </div>

          <!-- The controls wrap on narrow screens instead of scrolling out of view. -->
          <UDashboardToolbar :ui="{ root: 'flex-wrap gap-y-2 py-2', left: 'flex-wrap gap-y-2', right: 'max-sm:w-full' }">
            <template #left>
              <template v-if="state.view === 'compare'">
                <USelect v-model="state.base" :items="runItems" size="sm" class="w-28 sm:w-40" aria-label="Base run" />
                <UIcon name="i-lucide-arrow-right" class="size-4 text-muted shrink-0" />
              </template>
              <USelect v-model="state.run" :items="runItems" size="sm" class="w-28 sm:w-40" aria-label="Run" />
              <UTabs v-if="state.view !== 'pages'" v-model="state.env" :items="envItems" :content="false" size="xs" />
              <UTabs v-model="state.metric" :items="metricItems" :content="false" size="xs" aria-label="Size" />
            </template>
            <template #right>
              <UInput v-model="state.search" icon="i-lucide-search" :placeholder="state.view === 'pages' ? 'Search pages and files…' : state.view === 'issues' ? 'Search packages and files…' : 'Search files…'" size="sm" class="w-full sm:w-56" :ui="{ base: 'pointer-coarse:text-base' }" aria-label="Search" />
            </template>
          </UDashboardToolbar>
        </template>

        <template #body>
          <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Could not load the analysis" :description="pull ? `${error}. Reload this page to try again.` : `${error}. Check that nuxt-bundle-analyzer is still running, then reload this page.`" />

          <UEmpty
            v-else-if="loaded && runs.length === 0"
            icon="i-lucide-package-search"
            :title="pull ? 'No Comparison for This Pull Request' : 'No Analysis Yet'"
            :description="pull
              ? `Nothing was uploaded for #${pull.pull} yet. The bundle size workflow uploads it once both builds are analyzed.`
              : 'Run npx nuxt-bundle-analyzer in your Nuxt project to analyze its bundles, or open a comparison from a pull request comment.'"
          />

          <template v-else-if="(state.view === 'pages' || state.view === 'chunks') && data && !chunks.length">
            <UEmpty
              icon="i-lucide-file-x"
              :title="env === 'client' ? 'No Client Build to Show' : 'No Nitro Build to Show'"
              :description="env === 'client' ? 'This run has no client manifest, so its chunks are unknown. Run nuxt analyze again with the Vite builder to create it.' : 'This run has no report of the Nitro build. Run nuxt analyze again to create it.'"
            />
          </template>

          <PagesView
            v-else-if="state.view === 'pages' && data"
            :pages="pageList"
            :chunks="chunks"
            :metric="state.metric"
            :search="state.search"
            :focus="focusedRoute"
            @inspect="inspect"
            @open-chunk="openChunk"
          />

          <ChunksView
            v-else-if="state.view === 'chunks' && data"
            :chunks="chunks"
            :env="env"
            :metric="state.metric"
            :search="state.search"
            :focus="focusedChunk"
            @inspect="inspect"
          />

          <IssuesView
            v-else-if="state.view === 'issues' && data?.bundles[env]"
            :bundle="data.bundles[env]!"
            :metric="state.metric"
            :search="state.search"
            @inspect="inspect"
          />
          <UEmpty
            v-else-if="state.view === 'issues' && data"
            icon="i-lucide-file-x"
            :title="env === 'client' ? 'No Client Build to Show' : 'No Nitro Build to Show'"
            description="This run has no report of this build. Run nuxt analyze again to create it."
          />

          <template v-else-if="state.view === 'compare'">
            <UEmpty
              v-if="runs.length < 2"
              icon="i-lucide-git-compare"
              title="Compare Needs Two Runs"
              description="Make a change, then run nuxt analyze --name=after to compare it with this run."
            />
            <Compare
              v-else-if="data && baseData"
              :base="baseData"
              :current="data"
              :env="state.env"
              :metric="state.metric"
              :search="state.search"
              @inspect="inspect"
              @open-route="openRoute"
            />
          </template>

          <p class="mt-auto flex items-center justify-center gap-1.5 pt-6 text-xs text-muted">
            Powered by
            <ULink to="https://sonda.dev" target="_blank" class="flex items-center gap-1 font-medium text-muted hover:text-highlighted">
              <img src="/sonda.svg" alt="" class="size-3.5 rounded-xs">
              Sonda
            </ULink>
          </p>
        </template>
      </UDashboardPanel>
    </UDashboardGroup>

    <DetailPanel
      :target="inspected"
      :bundle="inspectedData?.bundles[env]"
      :chunks="inspectedChunks"
      :env="env"
      :metric="state.metric"
      :other-run="inspectedData && inspectedData !== data ? inspectedData.run.name : undefined"
      @inspect="inspect"
      @open-chunk="openChunk"
      @close="Object.assign(state, { file: '', package: '' })"
    />
  </UApp>
</template>
