<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <article><h3>{{ route.params.slug }}</h3><time>{{ formatDate(new Date()) }}</time></article>
</template>
