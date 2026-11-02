<script setup lang="ts">
import type { Bundle, Metric, Target } from '~/utils/data'
import { formatBytes, sourceKind } from '~/utils/data'

const props = defineProps<{
  bundle: Bundle
  metric: Metric
  search: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
}>()

const query = computed(() => props.search.trim().toLowerCase())
const matches = (texts: string[]) => !query.value || texts.some(text => text.toLowerCase().includes(query.value))

/** Packages bundled more than once, those whose extra copies weigh the most first. */
const duplicates = computed(() => [...props.bundle.duplicates]
  .map(([name, copies]) => {
    const sizes = copies.map(copy => copy[props.metric])
    // Keeping one copy, the largest, would save the size of the others.
    return {
      name,
      copies,
      extra: sizes.reduce((sum, size) => sum + size, 0) - Math.max(...sizes),
      withCode: sizes.filter(Boolean).length,
    }
  })
  .filter(duplicate => matches([
    duplicate.name,
    ...duplicate.copies.flatMap(copy => [copy.path, ...copy.importers]),
  ]))
  .sort((a, b) => b.extra - a.extra || a.name.localeCompare(b.name)))

const origins = {
  yours: 'In Your Code',
  // Nuxt's build of the app, such as the chunks of the Vue server build that Nitro bundles.
  build: 'In Nuxt’s Build',
  dependencies: 'In Dependencies',
} as const

/** Where a loop of imports is: through the project's own files, Nuxt's build of them, or only dependencies. */
function originOf(cycle: string[]): keyof typeof origins {
  if (cycle.some(id => !id.startsWith('node_modules/') && sourceKind({ id }) !== 'nuxt')) {
    return 'yours'
  }
  return cycle.some(id => id.startsWith('.nuxt/'))
    ? 'build'
    : 'dependencies'
}

/** Loops of imports grouped by where they are, those through the project's own files first. */
const cycleGroups = computed(() => (Object.keys(origins) as (keyof typeof origins)[])
  .map(origin => ({
    origin,
    cycles: props.bundle.cycles.filter(cycle => originOf(cycle) === origin && matches(cycle)).sort((a, b) => a.length - b.length),
  }))
  .filter(group => group.cycles.length > 0))
</script>

<template>
  <UCard :ui="{ header: 'py-3 sm:px-4', body: 'p-0 sm:p-0' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        Duplicate Packages
      </h3>
      <p class="text-sm text-muted">
        Packages bundled from more than one location, usually because two versions are installed.
      </p>
    </template>
    <ul v-if="duplicates.length" class="divide-y divide-default">
      <li v-for="duplicate in duplicates" :key="duplicate.name" class="space-y-3 px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <button class="flex min-w-0 items-center gap-2 text-left font-mono text-sm text-highlighted hover:text-primary hover:underline" :title="`Show details of ${duplicate.name}`" @click="emit('inspect', { kind: 'package', id: duplicate.name })">
            <UIcon name="i-vscode-icons-file-type-npm" class="size-4 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ duplicate.name }}</span>
          </button>
          <span class="shrink-0 text-sm text-muted">
            {{ duplicate.copies.length }} copies · {{ duplicate.extra ? `${formatBytes(duplicate.extra)} in extra copies` : duplicate.withCode ? 'only one has code in the output' : 'none has code in the output' }}
          </span>
        </div>
        <PackageCopies :copies="duplicate.copies" :metric="metric" class="ps-6" @inspect="target => emit('inspect', target)" />
      </li>
    </ul>
    <p v-else class="px-4 py-6 text-center text-sm text-muted">
      {{ query ? 'No duplicate package matches this search.' : 'No package is bundled more than once.' }}
    </p>
  </UCard>

  <UCard :ui="{ header: 'py-3 sm:px-4', body: 'p-0 sm:p-0' }">
    <template #header>
      <h3 class="text-base text-highlighted">
        Circular Imports
      </h3>
      <p class="text-sm text-muted">
        Files that import each other in a loop. One of them runs before the others are ready, so a value it imports can still be undefined.
      </p>
    </template>
    <section v-for="group in cycleGroups" :key="group.origin" class="border-b border-default last:border-0">
      <h4 class="bg-elevated/50 px-4 py-2 text-xs text-highlighted">
        {{ origins[group.origin] }}
      </h4>
      <ul class="divide-y divide-default">
        <li v-for="cycle in group.cycles" :key="cycle.join()" class="px-4 py-3">
          <ol class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <li v-for="(id, index) in [...cycle, cycle[0]!]" :key="index" class="flex min-w-0 items-center gap-1.5">
              <UIcon v-if="index > 0" :name="index === cycle.length ? 'i-lucide-repeat' : 'i-lucide-arrow-right'" class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
              <button class="flex min-w-0 items-center gap-1.5 text-left font-mono hover:text-primary hover:underline" :class="{ 'text-muted': index === cycle.length }" :title="`Show details of ${id}`" @click="emit('inspect', { kind: 'file', id })">
                <FileIcon :path="id" class="size-3.5" />
                <span class="break-all">{{ id }}</span>
              </button>
            </li>
          </ol>
        </li>
      </ul>
    </section>
    <p v-if="cycleGroups.length === 0" class="px-4 py-6 text-center text-sm text-muted">
      {{ query ? 'No circular import matches this search.' : 'No files import each other in a loop.' }}
    </p>
  </UCard>
</template>
