<script setup lang="ts">
const { color = 'neutral' } = defineProps<{
  icon: string
  title?: string
  description?: string
  color?: 'neutral' | 'warning' | 'error'
}>()

// Nuxt UI's subtle `UAlert`.
const colors = {
  neutral: 'bg-elevated/50 text-default ring-accented',
  warning: 'bg-warning/10 text-warning ring-warning/25',
  error: 'bg-error/10 text-error ring-error/25',
}
</script>

<template>
  <div class="flex gap-2.5 rounded-lg p-4 text-sm ring ring-inset" :class="colors[color]">
    <Icon :name="icon" class="size-5 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1 space-y-1">
      <p v-if="title" class="font-medium">
        {{ title }}
      </p>
      <div v-if="description || $slots.description" class="opacity-90">
        <slot name="description">
          {{ description }}
        </slot>
      </div>
    </div>
  </div>
</template>
