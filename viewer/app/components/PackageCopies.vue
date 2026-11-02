<script setup lang="ts">
import type { Metric, PackageCopy, Target } from '~/utils/data'
import { formatBytes, packageOf } from '~/utils/data'

const props = defineProps<{
  copies: PackageCopy[]
  metric: Metric
}>()

const emit = defineEmits<{
  inspect: [target: Target]
}>()

/** What imports each copy, with the files of one package grouped as that package. */
const importers = computed(() => new Map(props.copies.map((copy) => {
  const targets = new Map<string, { target: Target, files: number }>()
  for (const id of copy.importers) {
    const pkg = packageOf(id)
    const target: Target = pkg
      ? { kind: 'package', id: pkg }
      : { kind: 'file', id }
    const entry = targets.get(target.id) ?? { target, files: 0 }
    entry.files++
    targets.set(target.id, entry)
  }
  return [
    copy.path,
    [
      ...targets.values(),
    ],
  ]
})))
</script>

<template>
  <ul class="space-y-3">
    <li v-for="copy in copies" :key="copy.path">
      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="flex min-w-0 items-center gap-2">
          <UBadge v-if="copy.version" :label="copy.version" color="neutral" variant="subtle" size="sm" class="shrink-0 font-mono" />
          <span class="truncate font-mono text-xs text-muted" :title="copy.path">{{ copy.path }}</span>
        </span>
        <!-- A copy can be imported and still have none of its code in the output, as tree-shaking removed it. -->
        <span class="shrink-0 text-muted">{{ copy[metric] ? formatBytes(copy[metric]) : 'Tree-shaken' }}</span>
      </div>
      <p v-if="copy.importers.length" class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
        Imported by
        <button
          v-for="{ target, files } in importers.get(copy.path)"
          :key="target.id"
          class="font-mono text-default hover:text-primary hover:underline"
          :title="`Show details of ${target.id}`"
          @click="emit('inspect', target)"
        >
          {{ target.id }}<span v-if="files > 1" class="font-sans text-muted"> · {{ files }} files</span>
        </button>
      </p>
    </li>
  </ul>
</template>
