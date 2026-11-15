<script setup lang="ts">
// The trigger takes the name, such as `aria-label`: the select itself renders no element.
defineOptions({ inheritAttrs: false })

defineProps<{
  items: { label: string, value: string, description: string }[]
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <Select :value="model" :items="items" @value-change="value => value && (model = value)">
    <SelectTrigger class="w-28 min-w-0 sm:w-40" v-bind="$attrs">
      <SelectValue class="truncate" />
    </SelectTrigger>
    <SelectContent class="max-w-80">
      <SelectItem v-for="item in items" :key="item.value" :value="item.value" :label="item.label" class="h-auto py-1.5">
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ item.label }}</span>
          <span class="block truncate text-xs text-muted">{{ item.description }}</span>
        </span>
        <SelectItemIndicator />
      </SelectItem>
    </SelectContent>
  </Select>
</template>
