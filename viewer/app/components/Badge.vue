<script setup lang="ts">
const { color = 'neutral', variant = 'subtle', as = 'span' } = defineProps<{
  label?: string
  color?: 'neutral' | 'primary' | 'error' | 'success'
  variant?: 'subtle' | 'outline'
  /** The element, such as a button for a badge that opens what it names. */
  as?: string
}>()

const colors = {
  neutral: 'text-default border-default',
  primary: 'text-primary border-primary/60',
  error: 'text-error border-error/60',
  success: 'text-success border-success/60',
}
</script>

<template>
  <component
    :is="as"
    class="inline-flex shrink-0 items-center border px-1.5 py-px font-mono text-[0.6875rem] leading-4"
    :class="[colors[color], variant === 'subtle' ? 'bg-current/8' : 'bg-transparent']"
  >
    {{ label }}
  </component>
</template>
