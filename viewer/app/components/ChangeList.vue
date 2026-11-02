<script setup lang="ts">
import type { Change, Target } from '~/utils/data'
import { formatBytes, formatDelta } from '~/utils/data'

const props = defineProps<{
  title: string
  changes: Change[]
  baseName: string
  currentName: string
  /** Each key names a file or a package, which opens its details; otherwise keys are chunks. */
  sources?: boolean
  /** A line under a key, such as the routes that load a chunk. */
  notes?: Record<string, string>
  /** Shown when nothing changed. */
  empty: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
}>()

/** A key from a list of sources: `node_modules/<name>` for a package, a file otherwise. */
function targetOf(key: string): Target | undefined {
  if (!props.sources || key.startsWith('[')) {
    return undefined
  }
  return key.startsWith('node_modules/')
    ? {
        kind: 'package',
        id: key.slice('node_modules/'.length),
      }
    : { kind: 'file', id: key }
}

function size(bytes: number | undefined) {
  return bytes === undefined
    ? '—'
    : formatBytes(bytes)
}
function deltaClass(delta: number) {
  return delta > 0
    ? 'text-error'
    : delta < 0
      ? 'text-success'
      : 'text-muted'
}
</script>

<template>
  <section>
    <h4 class="mb-2 text-sm text-highlighted">
      {{ title }}
    </h4>
    <table v-if="changes.length" class="w-full text-xs">
      <thead class="text-muted">
        <tr>
          <th class="pb-1 text-left font-normal">
            <span class="sr-only">Name</span>
          </th>
          <th class="pb-1 ps-3 text-right font-normal">
            {{ baseName }}
          </th>
          <th class="pb-1 ps-3 text-right font-normal">
            {{ currentName }}
          </th>
          <th class="pb-1 ps-3 text-right font-normal">
            Difference
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="change in changes" :key="change.key">
          <td class="py-1 align-top">
            <component
              :is="targetOf(change.key) ? 'button' : 'span'"
              class="flex min-w-0 items-center gap-1.5 text-left font-mono"
              :class="{ 'hover:text-primary hover:underline': targetOf(change.key) }"
              :title="targetOf(change.key) ? `Show details of ${change.key}` : change.key"
              @click="targetOf(change.key) && emit('inspect', targetOf(change.key)!)"
            >
              <UIcon v-if="change.key.startsWith('node_modules/') && sources" name="i-vscode-icons-file-type-npm" class="size-3.5 shrink-0" aria-hidden="true" />
              <FileIcon v-else :path="change.key" class="size-3.5" />
              <span class="break-all">{{ sources && change.key.startsWith('node_modules/') ? change.key.slice('node_modules/'.length) : change.key }}</span>
            </component>
            <p v-if="notes?.[change.key]" class="ps-5 text-muted">
              {{ notes[change.key] }}
            </p>
          </td>
          <td class="py-1 ps-3 text-right align-top whitespace-nowrap text-muted">
            {{ size(change.base) }}
          </td>
          <td class="py-1 ps-3 text-right align-top whitespace-nowrap text-muted">
            {{ size(change.current) }}
          </td>
          <td class="py-1 ps-3 text-right align-top whitespace-nowrap" :class="deltaClass(change.delta)">
            {{ formatDelta(change.delta) }}
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="text-sm text-muted">
      {{ empty }}
    </p>
  </section>
</template>
