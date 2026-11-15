<script setup lang="ts">
const colorMode = useColorMode()
const dark = computed(() => colorMode.value === 'dark')
</script>

<template>
  <Button
    :aria-label="dark ? 'Switch to light mode' : 'Switch to dark mode'"
    data-variant="ghost"
    class="size-8 p-0"
    @click="colorMode.preference = dark ? 'light' : 'dark'"
  >
    <Icon :name="dark ? 'i-lucide-moon' : 'i-lucide-sun'" class="size-5" aria-hidden="true" />
  </Button>
</template>
