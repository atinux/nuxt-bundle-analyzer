<script setup lang="ts">
import { provider } from 'std-env'

const { count } = useCart()
</script>

<template>
  <header><NuxtLink to="/">Shop</NuxtLink> on {{ provider }} · {{ count }} items</header>
</template>
