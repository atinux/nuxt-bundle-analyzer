<script setup lang="ts">
import type { ChartPoint } from '@tanstack/charts'
import { barY, colorLegend, colorLegendItems, defineChart, lineY, ruleY } from '@tanstack/charts'
import { crosshair } from '@tanstack/charts/crosshair'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { scalePoint } from '@tanstack/charts/scales/point'
import { tooltip } from '@tanstack/charts/tooltip'
import { Chart as TanStackChart } from '@tanstack/charts/vue'

export interface ChartCategory {
  key: string
  label: string
  /** Defaults to the primary color. */
  color?: string
}

export interface ChartTooltipRow {
  label: string
  value: string
  color: string
  /** The series under the pointer, when the tooltip lists several. */
  active: boolean
}

interface Row {
  x: string
  category: string
  value: number
}

const props = defineProps<{
  /** Stacked bars, or one line per category. */
  type: 'bar' | 'line'
  data: Record<string, string | number>[]
  /** The field of each datum that is its x value. */
  index: string
  categories: ChartCategory[]
  format: (value: number) => string
  points?: boolean
  height: number
  /** The chart's accessible name. */
  label: string
}>()

const emit = defineEmits<{
  focusChange: [point: ChartPoint<Row> | null]
  select: [point: ChartPoint<Row> | null]
}>()

defineSlots<{
  tooltip: (props: { rows: ChartTooltipRow[] }) => unknown
}>()

const keys = computed(() => props.categories.map(category => category.key))
const labels = computed(() => new Map(props.categories.map(category => [category.key, category.label])))
const style = computed(() => Object.fromEntries(props.categories.map((category, index) => [`--ts-chart-${index + 1}`, category.color ?? 'var(--ui-primary)'])))

const rows = computed(() => props.data.flatMap(datum => props.categories
  .filter(({ key }) => typeof datum[key] === 'number')
  .map(({ key }): Row => ({
    x: String(datum[props.index]),
    category: key,
    value: datum[key] as number,
  }))))

const definition = computed(() => defineChart({
  marks: props.type === 'bar'
    ? [
        barY(rows.value, {
          x: 'x',
          y: 'value',
          z: 'category',
          color: 'category',
          inset: 1,
        }),
        ruleY([0]),
      ]
    : [
        lineY(rows.value, {
          x: 'x',
          y: 'value',
          z: 'category',
          color: 'category',
          strokeWidth: 2,
          points: props.points,
        }),
        crosshair({ x: true, y: false }),
      ],
  scales: {
    x: {
      scale: props.type === 'bar'
        ? () => scaleBand().padding(0.2)
        : () => scalePoint().padding(0),
      axis: false,
    },
    y: {
      scale: scaleLinear,
      nice: true,
      grid: true,
      axis: {
        ticks: { format: props.format },
      },
    },
  },
  color: {
    scale: scaleOrdinal().domain(keys.value).range(keys.value.map((_, index) => `var(--ts-chart-${index + 1})`)),
    legend: keys.value.length > 1
      ? colorLegend({
          items: colorLegendItems({
            justify: 'center',
            gap: 16,
            label: {
              format: value => labels.value.get(String(value)) ?? String(value),
            },
          }),
        })
      : undefined,
  },
  focus: 'group-x',
  // The default only focuses a point within 48 pixels, which leaves dead zones between sparse x values.
  maxFocusDistance: Number.POSITIVE_INFINITY,
  // The slot draws the tooltip; this is what screen readers announce for it.
  tooltip: {
    use: tooltip,
    format: point => describe([point]),
    formatGroup: describe,
  },
}))

function describe(points: readonly ChartPoint<Row>[]) {
  return [
    points[0]?.datum.x,
    ...tooltipRows(points, undefined).map(row => `${row.label} ${row.value}`),
  ].filter(Boolean).join(', ')
}

function tooltipRows(points: readonly ChartPoint<Row>[], primary: ChartPoint<Row> | undefined): ChartTooltipRow[] {
  return [...points]
    .sort((a, b) => keys.value.indexOf(a.datum.category) - keys.value.indexOf(b.datum.category))
    .map(point => ({
      label: labels.value.get(point.datum.category) ?? point.datum.category,
      value: props.format(point.datum.value),
      color: point.color ?? '',
      active: points.length > 1 && point === primary,
    }))
}
</script>

<template>
  <TanStackChart
    :definition="definition"
    :aria-label="label"
    :height="height"
    :style="style"
    :on-focus-change="point => emit('focusChange', point)"
    :on-select="point => emit('select', point)"
  >
    <template #tooltipBody="context">
      <div class="rounded-md bg-default px-2.5 py-1.5 shadow-sm ring ring-default">
        <slot name="tooltip" :rows="tooltipRows(context.points, context.primaryPoint)" />
      </div>
    </template>
  </TanStackChart>
</template>
