<script setup lang="ts">
import type { SegmentedItem } from '~/components/Segmented.vue'
import type { Env, Metric, Run, RunData, Target } from '~/utils/data'
import { clientChunks, fetchRun, fetchRuns, hostedBranch, hostedPull, isDuplicated, pages, prerenderedPages, serverChunks } from '~/utils/data'

type View = 'history' | 'pages' | 'chunks' | 'issues' | 'compare'

/** The pull request the hosted viewer shows, when it is opened from one. */
const pull = hostedPull()
const pullLink = pull && { to: `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.pull}`, label: `${pull.owner}/${pull.repo}#${pull.pull}` }
/** The branch whose history the hosted viewer shows, which opens on its History view. */
const branch = hostedBranch()
const branchLink = branch && { to: `https://github.com/${branch.owner}/${branch.repo}/tree/${branch.branch}`, label: `${branch.owner}/${branch.repo}` }
const VIEWS: View[] = branch
  ? [
      'history',
      'pages',
      'chunks',
      'issues',
      'compare',
    ]
  : ['pages', 'chunks', 'issues', 'compare']
const DEFAULT_VIEW = VIEWS[0]!

const route = useRoute()
const router = useRouter()

/** The view a query names, which is the default one when it names none. */
function viewOf(params: URLSearchParams) {
  return VIEWS.find(view => view === params.get('view')) ?? DEFAULT_VIEW
}

/** The viewer's state for the current URL, so navigating re-reads it client-side. */
function stateFromQuery() {
  const params = new URLSearchParams(location.search)
  return {
    view: viewOf(params),
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
    /** The chunk the package was picked in, when the panel shows only its files there. */
    chunk: params.get('chunk') ?? '',
  }
}

const state = reactive(stateFromQuery())

const runs = ref<Run[]>([])
const error = ref<string>()
const cache = new Map<string, Promise<RunData | undefined>>()
const data = shallowRef<RunData>()
const baseData = shallowRef<RunData>()

watch(state, () => {
  const query = new URLSearchParams()
  // The runs a fresh page picks are the home page's, so they stay out of the URL as well.
  const defaults: Record<string, string | undefined> = {
    view: DEFAULT_VIEW,
    env: 'client',
    metric: 'gzip',
    run: (runs.value.find(run => run.current) ?? runs.value[0])?.slug,
    base: runs.value
      .find(run => run.slug !== state.run)
      ?.slug,
  }
  for (const [key, value] of Object.entries({ ...state, q: state.search, search: '' })) {
    if (value && value !== defaults[key]) {
      query.set(key, value)
    }
  }
  // Keep vue-router's own history state, so its back and forward navigation keeps working,
  // and leave the path alone when every parameter is at its default.
  const url = query.size
    ? `?${query}`
    : location.pathname
  // A view picked in the app gets an entry of its own, so the browser's back returns to the view it
  // came from. Everything else stays in the entry it is already in, so typing in the search field,
  // a metric or a picked run is not a navigation. Back and forward restore a view by re-reading the
  // URL, which already names it, so they only ever replace.
  if (state.view === viewOf(new URLSearchParams(location.search))) {
    history.replaceState(history.state, '', url)
  }
  else {
    history.pushState(history.state, '', url)
  }
}, { deep: true })

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

// The hosted viewer only has the runs of pull requests and branches, so its home page shows
// straight away, rather than once a request says there is nothing to view.
const loaded = ref(useRuntimeConfig().public.hosted && !pull && !branch)

/** Keep the picked runs to ones the viewer has, falling back to its defaults. */
function pickRuns() {
  if (!runs.value.some(run => run.slug === state.run)) {
    state.run = (runs.value.find(run => run.current) ?? runs.value[0])?.slug ?? ''
  }
  if (!runs.value.some(run => run.slug === state.base)) {
    state.base = runs.value.find(run => run.slug !== state.run)?.slug ?? ''
  }
}

function fetchAllRuns() {
  fetchRuns().then((list) => {
    runs.value = list
    loaded.value = true
    pickRuns()
  }).catch((cause) => {
    error.value = String(cause)
  })
}

if (!loaded.value) {
  fetchAllRuns()
}

/** Re-reads the state from the URL, which holds all of it. */
function readState() {
  Object.assign(state, stateFromQuery())
  pickRuns()
}

// The path decides which pull request the hosted viewer shows and the query holds the whole UI
// state, so a NuxtLink's navigation to the home page re-reads both, without reloading the app.
watch(() => route.fullPath, readState)

// Back and forward change the URL without the router reporting it: the entries the app writes are
// not the router's own, so it can find the URL it restores to be the one it already shows and skip
// the navigation that would tell the page about it.
window.addEventListener('popstate', readState)
onBeforeUnmount(() => window.removeEventListener('popstate', readState))

/** The home page's URL, which the title links to. */
const home = router.resolve('/').fullPath

/**
 * The title's link home. The router skips a link to the URL it already shows, and the app moves on
 * from that URL on its own, so when the router would skip it, the app goes home itself.
 */
function openHome(event: MouseEvent) {
  if (route.fullPath !== home || location.pathname + location.search === home) {
    return
  }
  event.preventDefault()
  history.pushState(history.state, '', home)
  readState()
}

/** Nothing to view: the hosted viewer's home page, or `serve` before any analysis. */
const empty = computed(() => loaded.value && runs.value.length === 0)

/**
 * Until the runs and their reports are in, which takes a few seconds for a large app's hosted
 * comparison. History only needs the list of commits, so it downloads no reports.
 */
const loading = computed(() => !error.value && (!loaded.value || (state.view !== 'history' && ((runs.value.length > 0 && !data.value) || (state.view === 'compare' && runs.value.length > 1 && !baseData.value)))))

// Runs load asynchronously, so a run named in the URL is only found once they are there.
// A run picked while another still downloads wins, even when the earlier one finishes last or fails.
// A failed download of a picked run shows the error instead of loading forever.
// History downloads no reports, so neither watcher loads one while it shows.
watch(() => [state.run, runs.value, state.view === 'history'] as const, async ([slug, , history], _, onCleanup) => {
  if (history) {
    return
  }
  let picked = true
  onCleanup(() => picked = false)
  try {
    const run = await load(slug)
    if (!picked) {
      return
    }
    data.value = run
    if (run && !run.bundles[state.env]) {
      state.env = run.bundles.client ? 'client' : 'nitro'
    }
  }
  catch (cause) {
    if (picked) {
      error.value = String(cause)
    }
  }
}, { immediate: true })
watch(() => [state.base, runs.value, state.view === 'history'] as const, async ([slug, , history], _, onCleanup) => {
  if (history) {
    return
  }
  let picked = true
  onCleanup(() => picked = false)
  try {
    const run = await load(slug)
    if (picked) {
      baseData.value = run
    }
  }
  catch (cause) {
    if (picked) {
      error.value = String(cause)
    }
  }
}, { immediate: true })

/** Compares a commit of the history with the one before it. */
function compareCommit(sha: string) {
  const index = runs.value.findIndex(run => run.slug === sha)
  Object.assign(state, {
    view: 'compare',
    run: sha,
    // Runs are newest first, so the commit before is the next one.
    base: runs.value[index + 1]?.slug ?? state.base,
  })
}

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
const clientChunkList = computed(() => chunksOf(data.value, 'client'))
const pageList = computed(() => data.value
  ? pages(data.value, clientChunkList.value)
  : [])
// Checked first, so a run without prerendered pages doesn't derive them.
const prerenderedList = computed(() => data.value?.prerendered.length
  ? prerenderedPages(data.value, clientChunkList.value)
  : [])

const focusedChunk = ref<string>()
async function openChunk(file: string) {
  Object.assign(state, {
    view: 'chunks',
    env: env.value,
    file: '',
    package: '',
    chunk: '',
  })
  // Cleared first, so picking the same chunk again still scrolls to it.
  focusedChunk.value = undefined
  await nextTick()
  focusedChunk.value = file
}

const inspected = computed<Target | undefined>(() => state.package
  ? { kind: 'package', id: state.package, chunk: state.chunk || undefined }
  : state.file
    ? { kind: 'file', id: state.file }
    // Without a package, the chunk is the one the panel shows.
    : state.chunk
      ? { kind: 'chunk', id: state.chunk }
      : undefined)
function inspect(target: Target) {
  Object.assign(state, target.kind === 'package'
    ? { package: target.id, file: '', chunk: target.chunk ?? '' }
    : target.kind === 'chunk'
      ? { chunk: target.id, file: '', package: '' }
      : { file: target.id, package: '', chunk: '' })
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
  if (!bundle) {
    return 0
  }
  const duplicates = Array.from(bundle.duplicates.values()).filter(isDuplicated)
  return duplicates.length + bundle.cycles.length
})
const viewItems = computed<SegmentedItem<View>[]>(() => [
  ...branch
    ? [
        { label: 'History', value: 'history' as const },
      ]
    : [],
  { label: 'Pages', value: 'pages' },
  { label: 'Chunks', value: 'chunks' },
  { label: 'Issues', value: 'issues', badge: issueCount.value || undefined },
  { label: 'Compare', value: 'compare' },
])
/** Whether there is a build to show: in the run, or in History, in any commit. */
function hasBuild(of: Env) {
  return state.view === 'history'
    ? runs.value.some(run => run.commit?.sizes[of])
    : !!data.value?.bundles[of]
}
const envItems = computed<SegmentedItem<Env>[]>(() => [
  {
    label: 'Client',
    value: 'client',
    icon: 'i-lucide-monitor',
    disabled: !hasBuild('client'),
  },
  {
    label: 'Nitro',
    value: 'nitro',
    icon: 'i-lucide-server',
    disabled: !hasBuild('nitro'),
  },
])
const runItems = computed(() => runs.value.map(run => ({
  label: `${run.name}${run.current ? ' (latest)' : ''}`,
  value: run.slug,
  description: run.commit?.message ?? new Date(run.endTime).toLocaleString(),
})))
// Raw is the size on disk: minified for the client build, as Nitro writes it for the server.
const metricItems: SegmentedItem<Metric>[] = [
  { label: 'Raw', value: 'uncompressed' },
  { label: 'Gzip', value: 'gzip' },
  { label: 'Brotli', value: 'brotli' },
]
</script>

<template>
  <!-- On phones the page scrolls as a document rather than inside the main area, so the browser can
       collapse its toolbar and the footer clears floating bars such as Arc's. -->
  <div class="flex h-dvh flex-col max-sm:h-auto">
    <header class="relative z-10 shrink-0 border-b border-primary/40 bg-default/85 shadow-[0_1px_24px_-8px_var(--neon-magenta)] backdrop-blur-md">
      <div class="flex h-16 items-center justify-between gap-1.5 border-b border-default px-4 sm:px-6">
        <h1 class="flex min-w-0 items-center gap-1.5 text-lg">
          <NuxtLink to="/" aria-label="Bundle Analyzer home" class="neon-text flex shrink-0 items-center gap-2 uppercase" @click="openHome">
            <img src="/favicon.svg" alt="Nuxt" class="size-6 drop-shadow-[0_0_6px_var(--neon-cyan)]">
            Bundle Analyzer
          </NuxtLink>
          <!-- Narrow screens keep the pull request's number, so it stays clear which one this is. -->
          <NuxtLink v-if="pull && pullLink" :to="pullLink.to" target="_blank" :aria-label="`Pull request ${pullLink.label} on GitHub`" class="ms-1 flex items-center gap-1 font-sans text-sm font-normal tracking-normal text-muted hover:text-secondary">
            <Icon name="i-lucide-git-pull-request" class="size-4 shrink-0" aria-hidden="true" />
            <span class="sm:hidden">#{{ pull.pull }}</span>
            <span class="max-sm:hidden">{{ pullLink.label }}</span>
          </NuxtLink>
          <NuxtLink v-if="branch && branchLink" :to="branchLink.to" target="_blank" :aria-label="`Branch ${branch.branch} of ${branchLink.label} on GitHub`" class="ms-1 flex min-w-0 items-center gap-1 font-sans text-sm font-normal tracking-normal text-muted hover:text-secondary">
            <Icon name="i-lucide-git-branch" class="size-4 shrink-0" aria-hidden="true" />
            <span class="max-sm:hidden">{{ branchLink.label }}</span>
            <span class="truncate">{{ branch.branch }}</span>
          </NuxtLink>
        </h1>
        <Segmented v-if="!empty" v-model="state.view" :items="viewItems" aria-label="View" class="max-sm:hidden" />
      </div>

      <!-- Narrow screens give the views a row of their own, so the title keeps its room. -->
      <div v-if="!empty" class="border-b border-default px-4 py-2 sm:hidden">
        <Segmented v-model="state.view" :items="viewItems" aria-label="View" class="flex w-full *:data-[slot=segmented-control-item]:flex-1" />
      </div>

      <!-- The controls wrap on narrow screens instead of scrolling out of view. -->
      <div v-if="!empty" class="flex flex-wrap items-center justify-between gap-1.5 gap-y-2 px-4 py-2 sm:px-6">
        <div class="flex flex-wrap items-center gap-1.5 gap-y-2">
          <template v-if="state.view === 'compare'">
            <RunSelect v-model="state.base" :items="runItems" aria-label="Base run" />
            <Icon name="i-lucide-arrow-right" class="size-4 shrink-0 text-secondary" aria-hidden="true" />
          </template>
          <!-- History shows every commit, so it has no run to pick. -->
          <RunSelect v-if="state.view !== 'history'" v-model="state.run" :items="runItems" aria-label="Run" />
          <Segmented v-if="state.view !== 'pages'" v-model="state.env" :items="envItems" aria-label="Build" />
          <Segmented v-model="state.metric" :items="metricItems" aria-label="Size" />
        </div>
        <InputGroup class="relative w-full sm:w-56">
          <Icon name="i-lucide-search" class="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input v-model="state.search" :placeholder="state.view === 'history' ? 'Search commits…' : state.view === 'pages' ? 'Search pages and files…' : state.view === 'issues' ? 'Search packages and files…' : state.view === 'compare' ? 'Search routes or files…' : 'Search files…'" class="ps-8 pointer-coarse:text-base" aria-label="Search" />
        </InputGroup>
      </div>
    </header>

    <!-- The main area scrolls, so its sections keep their height instead of shrinking to fit it. It is
         positioned, so an absolutely positioned element inside it, such as a row's screen-reader
         label, stays in its scroll area. -->
    <main class="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 tabular-nums *:shrink-0 sm:gap-6 sm:p-6 max-sm:overflow-visible">
      <Callout v-if="error" color="error" icon="i-lucide-circle-alert" title="Could not load the analysis" :description="pull || branch ? `${error}. Reload this page to try again.` : `${error}. Check that nuxt-bundle-analyzer is still running, then reload this page.`" />

      <!-- The shape of the views below, so the page doesn't jump once the reports are in. -->
      <div v-else-if="loading" role="status" class="space-y-6">
        <p class="text-sm text-muted">
          {{ pull ? `Loading the comparison of #${pull.pull}…` : branch ? (state.view === 'history' ? `Loading the history of ${branch.branch}…` : `Loading the analysis of ${runs.find(run => run.slug === state.run)?.name ?? branch.branch}…`) : 'Loading the analysis…' }}
        </p>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div v-for="card in 2" :key="card" class="h-24 animate-pulse bg-accented/60 motion-reduce:animate-none" />
        </div>
        <div class="divide-y divide-default border border-default">
          <div v-for="row in 8" :key="row" class="flex items-center gap-4 px-4 py-3">
            <div class="h-4 animate-pulse bg-accented/60 motion-reduce:animate-none" :style="{ width: `${[45, 30, 38, 52, 26, 41, 33, 48][row - 1]}%` }" />
            <div class="ms-auto h-4 w-16 animate-pulse bg-accented/60 motion-reduce:animate-none" />
          </div>
        </div>
      </div>

      <EmptyState
        v-else-if="empty && pull"
        icon="i-lucide-package-search"
        title="No Comparison for This Pull Request"
        :description="`Nothing was uploaded for #${pull.pull} yet. The bundle size workflow uploads it once both builds are analyzed.`"
      />

      <EmptyState
        v-else-if="empty && branch"
        icon="i-lucide-git-branch"
        :title="`No History for ${branch.branch}`"
        :description="`Nothing was uploaded for ${branch.branch} yet. Each push adds its commit once the workflow uploads its build.`"
      />

      <HomeView v-else-if="empty" />

      <HistoryView
        v-else-if="state.view === 'history'"
        :runs="runs"
        :env="state.env"
        :metric="state.metric"
        :search="state.search"
        :repository="`${branch!.owner}/${branch!.repo}`"
        @compare="compareCommit"
      />

      <template v-else-if="(state.view === 'pages' || state.view === 'chunks') && data && !chunks.length">
        <EmptyState
          icon="i-lucide-file-x"
          :title="env === 'client' ? 'No Client Build to Show' : 'No Nitro Build to Show'"
          :description="env === 'client' ? 'This run has no client manifest, so its chunks are unknown. Run nuxt analyze again with the Vite builder to create it.' : 'This run has no report of the Nitro build. Run nuxt analyze again to create it.'"
        />
      </template>

      <PagesView
        v-else-if="state.view === 'pages' && data"
        :pages="pageList"
        :chunks="chunks"
        :prerendered="prerenderedList"
        :metric="state.metric"
        :search="state.search"
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
      <EmptyState
        v-else-if="state.view === 'issues' && data"
        icon="i-lucide-file-x"
        :title="env === 'client' ? 'No Client Build to Show' : 'No Nitro Build to Show'"
        description="This run has no report of this build. Run nuxt analyze again to create it."
      />

      <template v-else-if="state.view === 'compare'">
        <EmptyState
          v-if="runs.length < 2"
          icon="i-lucide-git-compare"
          title="Compare Needs Two Runs"
          :description="branch ? `The history of ${branch.branch} has one commit so far.` : 'Make a change, then run nuxt analyze --name=after to compare it with this run.'"
        />
        <Compare
          v-else-if="data && baseData"
          :base="baseData"
          :current="data"
          :env="state.env"
          :metric="state.metric"
          :search="state.search"
          @inspect="inspect"
          @open-chunk="openChunk"
        />
      </template>

      <p class="mt-auto flex items-center justify-center gap-1.5 pt-6 text-xs text-muted">
        Powered by
        <NuxtLink to="https://sonda.dev" target="_blank" class="flex items-center gap-1 font-medium text-muted hover:text-secondary">
          <img src="/sonda.svg" alt="" class="size-3.5 rounded-xs">
          Sonda
        </NuxtLink>
      </p>
    </main>
  </div>

  <DetailPanel
    :target="inspected"
    :bundle="inspectedData?.bundles[env]"
    :chunks="inspectedChunks"
    :env="env"
    :metric="state.metric"
    :other-run="inspectedData && inspectedData !== data ? inspectedData.run.name : undefined"
    @inspect="inspect"
    @open-chunk="openChunk"
    @close="Object.assign(state, { file: '', package: '', chunk: '' })"
  />
</template>
