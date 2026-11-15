<script setup lang="ts">
defineProps<{
  headerClass?: string
  bodyClass?: string
}>()
</script>

<template>
  <section class="divide-y divide-default rounded-lg bg-default ring ring-default">
    <header v-if="$slots.header" class="px-4 py-3" :class="headerClass">
      <slot name="header" />
    </header>
    <div :class="bodyClass">
      <slot />
    </div>
  </section>
</template>
