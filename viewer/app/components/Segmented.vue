<script setup lang="ts" generic="T extends string">
export interface SegmentedItem<T extends string = string> {
  label: string
  value: T
  icon?: string
  disabled?: boolean
  /** A count shown after the label, such as the issues a view lists. */
  badge?: number
}

defineProps<{
  items: SegmentedItem<T>[]
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
  <SegmentedControl :value="model" @value-change="value => value && (model = value as T)">
    <SegmentedControlIndicator />
    <SegmentedControlItem v-for="item in items" :key="item.value" :value="item.value" :disabled="item.disabled">
      <Icon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" aria-hidden="true" />
      {{ item.label }}
      <span v-if="item.badge !== undefined" class="min-w-5 rounded-sm bg-current/15 px-1 text-center text-xs">{{ item.badge }}</span>
    </SegmentedControlItem>
  </SegmentedControl>
</template>
