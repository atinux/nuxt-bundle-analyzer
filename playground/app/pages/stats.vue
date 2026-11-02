<script setup lang="ts">
const show = ref(false)
</script>

<template>
  <main>
    <h1>Stats</h1><BaseButton @click="show = true">
      Show chart
    </BaseButton><LazyHeavyChart v-if="show" />
  </main>
</template>
