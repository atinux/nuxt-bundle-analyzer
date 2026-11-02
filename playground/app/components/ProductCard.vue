<script setup lang="ts">
defineProps<{ name: string, price: number }>()
const { add } = useCart()
</script>

<template>
  <article>
    <h3>{{ name }}</h3><p>{{ formatPrice(price) }}</p><BaseButton @click="add">
      Add to cart
    </BaseButton>
  </article>
</template>
