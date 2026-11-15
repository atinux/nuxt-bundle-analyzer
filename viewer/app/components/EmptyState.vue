<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description: string
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 border border-dashed border-default px-6 py-12 text-center">
    <span class="flex size-12 items-center justify-center border border-primary/60 text-primary shadow-[0_0_18px_-4px_var(--neon-magenta)]">
      <Icon :name="icon" class="size-6" aria-hidden="true" />
    </span>
    <h2 class="text-base text-highlighted">
      {{ title }}
    </h2>
    <p class="max-w-md text-sm text-pretty text-muted">
      {{ description }}
    </p>
  </div>
</template>
