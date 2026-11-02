<template>
  <main><h1>Products</h1><ProductCard v-for="i in 3" :key="i" :name="`Product ${i}`" :price="i * 10" /></main>
</template>
