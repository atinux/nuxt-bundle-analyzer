<script setup lang="ts">
import fc from 'fast-check'

const sample = fc.sample(fc.integer({ min: 0, max: 100 }), 20)
</script>

<template>
  <pre>{{ sample }}</pre>
</template>
