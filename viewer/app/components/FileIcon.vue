<script setup lang="ts">
const props = defineProps<{
  /** A file path, such as `app/pages/index.vue`. */
  path: string
}>()

// The caller sets the size, to match the text next to it.
// Written out in full so Nuxt Icon finds them and bundles them with the app.
const icons: Record<string, string> = {
  vue: 'i-vscode-icons-file-type-vue',
  ts: 'i-vscode-icons-file-type-typescript-official',
  mts: 'i-vscode-icons-file-type-typescript-official',
  cts: 'i-vscode-icons-file-type-typescript-official',
  tsx: 'i-vscode-icons-file-type-reactts',
  js: 'i-vscode-icons-file-type-js-official',
  mjs: 'i-vscode-icons-file-type-js-official',
  cjs: 'i-vscode-icons-file-type-js-official',
  jsx: 'i-vscode-icons-file-type-reactjs',
  css: 'i-vscode-icons-file-type-css',
  json: 'i-vscode-icons-file-type-json',
}

const icon = computed(() => icons[props.path.split('?')[0]!.split('.').pop()!.toLowerCase()] ?? 'i-vscode-icons-default-file')
</script>

<template>
  <UIcon :name="icon" class="shrink-0" aria-hidden="true" />
</template>
