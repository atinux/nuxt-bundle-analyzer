<script setup lang="ts">
const { color = 'neutral', variant = 'subtle', as = 'span' } = defineProps<{
  label?: string
  color?: 'neutral' | 'primary' | 'error' | 'success'
  variant?: 'subtle' | 'outline'
  /** The element, such as a button for a badge that opens what it names. */
  as?: string
}>()

// Nuxt UI's `UBadge` colors: a tint and an inset ring of the color, or of the accented border for neutral.
const colors = {
  neutral: { subtle: 'bg-elevated text-default ring-accented', outline: 'text-default ring-accented' },
  primary: { subtle: 'bg-primary/10 text-primary ring-primary/25', outline: 'text-primary ring-primary/50' },
  error: { subtle: 'bg-error/10 text-error ring-error/25', outline: 'text-error ring-error/50' },
  success: { subtle: 'bg-success/10 text-success ring-success/25', outline: 'text-success ring-success/50' },
}
</script>

<template>
  <component :is="as" class="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring ring-inset" :class="colors[color][variant]">
    {{ label }}
  </component>
</template>
