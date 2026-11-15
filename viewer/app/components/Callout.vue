<script setup lang="ts">
const { color = 'neutral' } = defineProps<{
  icon: string
  title?: string
  description?: string
  color?: 'neutral' | 'warning' | 'error'
}>()

const colors = {
  neutral: 'border-secondary/50 text-secondary',
  warning: 'border-warning/50 text-warning',
  error: 'border-error/60 text-error',
}
</script>

<template>
  <div class="flex gap-2.5 border border-s-2 bg-current/5 px-4 py-3 text-sm" :class="colors[color]">
    <Icon :name="icon" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div class="min-w-0 space-y-1">
      <p v-if="title" class="font-heading font-semibold tracking-wide">
        {{ title }}
      </p>
      <div v-if="description || $slots.description" class="text-default">
        <slot name="description">
          {{ description }}
        </slot>
      </div>
    </div>
  </div>
</template>
