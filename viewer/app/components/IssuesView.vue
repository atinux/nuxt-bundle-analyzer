<script setup lang="ts">
import type { Bundle, Metric, Target } from '~/utils/data'
import { formatBytes, isDuplicated } from '~/utils/data'

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
  // Copies tree-shaken out of the output cost nothing, so they are not an issue.
  .filter(([, copies]) => isDuplicated(copies))
  .map(([name, copies]) => {
    const sizes = copies.map(copy => copy[props.metric])
    // Keeping one copy, the largest, would save the size of the others.
    return {
      name,
      copies,
      extra: sizes.reduce((sum, size) => sum + size, 0) - Math.max(...sizes),
    }
  })
  .filter(duplicate => matches([
    duplicate.name,
    ...duplicate.copies.flatMap(copy => [copy.path, ...copy.importers]),
  ]))
  .sort((a, b) => b.extra - a.extra || a.name.localeCompare(b.name)))

/** Loops of imports through the project's own files, the shortest first. */
const cycles = computed(() => props.bundle.cycles.filter(matches).sort((a, b) => a.length - b.length))
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
            {{ duplicate.copies.length }} copies · {{ formatBytes(duplicate.extra) }} in extra copies
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
    <ul v-if="cycles.length" class="divide-y divide-default">
      <li v-for="cycle in cycles" :key="cycle.join()" class="px-4 py-3">
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
    <p v-else class="px-4 py-6 text-center text-sm text-muted">
      {{ query ? 'No circular import matches this search.' : 'None of your files import each other in a loop.' }}
    </p>
  </UCard>
</template>
