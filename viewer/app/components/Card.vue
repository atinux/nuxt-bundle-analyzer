<script setup lang="ts">
defineProps<{
  headerClass?: string
  bodyClass?: string
}>()
</script>

<template>
  <section class="neon-edge border border-default bg-elevated/70 backdrop-blur-sm">
    <header v-if="$slots.header" class="border-b border-default px-4 py-3" :class="headerClass">
      <slot name="header" />
    </header>
    <div :class="bodyClass">
      <slot />
    </div>
  </section>
</template>
