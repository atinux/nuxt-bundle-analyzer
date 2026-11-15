<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description: string
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
    <Icon :name="icon" class="mb-2 size-10 text-dimmed" aria-hidden="true" />
    <h2 class="text-base text-highlighted">
      {{ title }}
    </h2>
    <p class="max-w-md text-sm text-pretty text-muted">
      {{ description }}
    </p>
  </div>
</template>
