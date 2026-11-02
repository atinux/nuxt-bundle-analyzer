<template>
  <button class="btn" @click="$emit('click')">
    <slot />
  </button>
</template>

<style scoped>
.btn { padding: .5rem 1rem; border-radius: .5rem; background: #00dc82 }
</style>
