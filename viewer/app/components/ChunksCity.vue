<script setup lang="ts">
import type { ChunkInfo, Env, Metric, Target } from '~/utils/data'
import type { Rect } from '~/utils/treemap'

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

import { formatBytes, formatDelta, sourceKind } from '~/utils/data'
import { inset, squarify } from '~/utils/treemap'

const props = defineProps<{
  chunks: ChunkInfo[]
  /** The chunks of the run to compare with, to color each building by how it changed. */
  base?: ChunkInfo[]
  env: Env
  metric: Metric
  search: string
}>()

const emit = defineEmits<{
  inspect: [target: Target]
  openChunk: [file: string]
}>()

/** The side of the ground, in scene units. */
const SIZE = 100
// Low next to the ground's side, so buildings read as a city rather than as slabs.
const MAX_HEIGHT = 12
const PLOT_HEIGHT = 0.4
/** The number of chunks named on the map, the largest ones, as long as their plot has room for a name. */
const LABELS = 8
const LABEL_MIN_AREA = 60

type Kind = 'yours' | 'dependency' | 'generated'

/** A building: one of the project's files, a package, or code Nuxt generates, in one chunk. */
interface Building {
  chunk: ChunkInfo
  id: string
  kind: Kind
  target?: Target
  size: number
  /** Its size in the base run, when comparing: 0 when it is new. */
  before?: number
  rect: Rect
  height: number
}

interface Plot {
  chunk: ChunkInfo
  size: number
  before?: number
  rect: Rect
  height: number
}

const container = useTemplateRef<HTMLDivElement>('container')
const unsupported = ref(false)
const hovered = ref<{ x: number, y: number, title: string, lines: string[] }>()

/** How many routes load a chunk before rendering, as a share of them; Nitro's chunks get one height. */
function reach(chunk: ChunkInfo, routes: number) {
  if (!chunk.loadedBy) {
    return 0.45
  }
  if (chunk.loadedBy === 'all') {
    return 1
  }
  if (chunk.loadedBy === 'lazy') {
    return 0.08
  }
  return 0.2 + 0.8 * chunk.loadedBy.length / routes
}

/** The buildings of a chunk: each of the project's files, each package as one, and Nuxt's code. */
function buildingsOf(chunk: ChunkInfo | undefined, metric: Metric) {
  const parts = new Map<string, Omit<Building, 'rect' | 'height'>>()
  for (const part of chunk?.contents ?? []) {
    const kind = sourceKind(part)
    const id = part.package
      ? `node_modules/${part.package}`
      : part.id
    const building = parts.get(id) ?? {
      chunk: chunk!,
      id,
      kind: kind === 'dependency'
        ? 'dependency'
        : kind === 'nuxt'
          ? 'generated'
          : 'yours',
      target: part.package
        ? { kind: 'package', id: part.package }
        : id.startsWith('[')
          ? undefined
          : { kind: 'file', id },
      size: 0,
    }
    building.size += part[metric]
    parts.set(id, building)
  }
  return parts
}

const city = computed(() => {
  const routes = new Set(props.chunks.flatMap(chunk => Array.isArray(chunk.loadedBy)
    ? chunk.loadedBy
    : [])).size || 1
  const current = new Map(props.chunks.map(chunk => [chunk.file, chunk]))
  const base = props.base && new Map(props.base.map(chunk => [chunk.file, chunk]))
  // Compared, chunks are matched by name, which has no hash, and buildings by file or package.
  const files = [
    ...new Set([
      ...current.keys(),
      ...base?.keys() ?? [],
    ]),
  ]
  const chunks = files
    .map((file) => {
      const chunk = (current.get(file) ?? base?.get(file))!
      const parts = buildingsOf(current.get(file), props.metric)
      if (base) {
        for (const building of parts.values()) {
          building.before = 0
        }
        for (const [id, before] of buildingsOf(base.get(file), props.metric)) {
          const building = parts.get(id) ?? { ...before, chunk, size: 0 }
          building.before = before.size
          parts.set(id, building)
        }
      }
      // A building takes the room of its larger size, so code a change removes keeps its place.
      const buildings = [
        ...parts.values(),
      ].map(building => ({
        ...building,
        area: Math.max(building.size, building.before ?? 0),
      })).filter(building => building.area > 0)
      return {
        chunk,
        buildings,
        size: buildings.reduce((sum, building) => sum + building.size, 0),
        before: base && buildings.reduce((sum, building) => sum + (building.before ?? 0), 0),
        area: buildings.reduce((sum, building) => sum + building.area, 0),
      }
    })
    .filter(chunk => chunk.area > 0)

  const plots: Plot[] = []
  const buildings: Building[] = []
  const ghosts: Building[] = []
  const rects = squarify(chunks.map(chunk => chunk.area), {
    x: -SIZE / 2,
    y: -SIZE / 2,
    w: SIZE,
    h: SIZE,
  })
  chunks.forEach((entry, index) => {
    const height = Math.max(0.6, MAX_HEIGHT * reach(entry.chunk, routes))
    const plot = inset(rects[index]!, 1)
    plots.push({
      chunk: entry.chunk,
      size: entry.size,
      before: entry.before,
      rect: plot,
      height,
    })
    const lots = squarify(entry.buildings.map(building => building.area), inset(plot, 0.5))
    entry.buildings.forEach(({ area: _, ...building }, i) => (building.size > 0
      ? buildings
      : ghosts).push({
      ...building,
      rect: inset(lots[i]!, 0.35),
      height,
    }))
  })
  return { plots, buildings, ghosts }
})

/** A theme color, which Nuxt UI writes in OKLCH, as three.js reads colors: in sRGB. */
function themeColor(name: string, fallback: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.fillStyle = fallback
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace)
}

/** A stable small number for a name, so a package keeps its shade between renders. */
function hash(text: string) {
  let value = 0
  for (const char of text) {
    value = (value * 31 + char.charCodeAt(0)) | 0
  }
  return (value >>> 0) % 1000 / 1000
}

let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let labels: CSS2DRenderer
let controls: OrbitControls
let buildingMesh: THREE.InstancedMesh | undefined
let plotMesh: THREE.InstancedMesh | undefined
/** What a change removed, where it stood in the base run. */
let ghostMesh: THREE.InstancedMesh | undefined
const labelObjects: CSS2DObject[] = []
const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 6, SIZE + 6), new THREE.MeshStandardMaterial({ roughness: 1 }))
const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 })
const ghostMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.85,
  metalness: 0,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
})
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let dirty = true
let frame = 0
let highlighted: number | undefined

const colorMode = useColorMode()

/** Colors every building and plot from the theme, dimming what the search leaves out. */
function paint() {
  if (!buildingMesh || !plotMesh || !scene) {
    return
  }
  const background = themeColor('--ui-bg', '#0a0a0a')
  scene.background = background
  ;(ground.material as THREE.MeshStandardMaterial).color = themeColor('--ui-bg-muted', '#171717')
  const plotColor = themeColor('--ui-bg-accented', '#262626')
  const colors: Record<Kind, THREE.Color> = {
    yours: themeColor('--ui-primary', '#00dc82'),
    dependency: themeColor('--ui-text-muted', '#a3a3a3'),
    generated: themeColor('--ui-text-dimmed', '#737373'),
  }
  // Compared, a building says how it changed instead of what it is: red when it grew, green when
  // it shrank, the more so the larger its change, and dimmed when it did not change.
  const grew = themeColor('--ui-error', '#ef4444')
  const shrank = themeColor('--ui-success', '#22c55e')
  const unchanged = colors.generated.clone().lerp(background, 0.45)
  const changeColor = (building: Building) => {
    const delta = building.size - building.before!
    if (delta === 0) {
      return unchanged.clone()
    }
    // A few bytes off a large package stay grey; new code, or a tenth more, reads clearly.
    const share = Math.min(1, Math.sqrt(Math.abs(delta) / Math.max(building.size, building.before!) * 4))
    return unchanged.clone().lerp(delta > 0
      ? grew
      : shrank, share)
  }
  const query = props.search.trim().toLowerCase()
  city.value.buildings.forEach((building, index) => {
    const color = building.before === undefined
      ? colors[building.kind].clone()
      : changeColor(building)
    // Packages differ slightly in shade, so neighbors read apart.
    if (building.kind === 'dependency' && building.before === undefined) {
      color.offsetHSL(0, 0, (hash(building.id) - 0.5) * 0.3)
    }
    if (index === highlighted) {
      color.lerp(new THREE.Color(colorMode.value === 'dark'
        ? 0xFFFFFF
        : 0x000000), 0.35)
    }
    else if (query && !building.id.toLowerCase().includes(query) && !building.chunk.file.toLowerCase().includes(query)) {
      color.lerp(background, 0.82)
    }
    buildingMesh!.setColorAt(index, color)
  })
  // A light ground needs more of a ghost to show it.
  ghostMaterial.opacity = colorMode.value === 'dark'
    ? 0.22
    : 0.45
  city.value.ghosts.forEach((building, index) => {
    const color = shrank.clone()
    if (query && !building.id.toLowerCase().includes(query) && !building.chunk.file.toLowerCase().includes(query)) {
      color.lerp(background, 0.82)
    }
    ghostMesh!.setColorAt(index, color)
  })
  city.value.plots.forEach((_, index) => plotMesh!.setColorAt(index, plotColor))
  buildingMesh.instanceColor!.needsUpdate = true
  plotMesh.instanceColor!.needsUpdate = true
  if (ghostMesh?.instanceColor) {
    ghostMesh.instanceColor.needsUpdate = true
  }
  dirty = true
}

function instances(rects: { rect: Rect, height: number }[], height: (entry: { height: number }) => number, of = material) {
  const mesh = new THREE.InstancedMesh(box, of, Math.max(rects.length, 1))
  mesh.count = rects.length
  const matrix = new THREE.Matrix4()
  rects.forEach((entry, index) => {
    matrix.makeScale(Math.max(entry.rect.w, 0.01), height(entry), Math.max(entry.rect.h, 0.01))
    matrix.setPosition(entry.rect.x + entry.rect.w / 2, 0, entry.rect.y + entry.rect.h / 2)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/** Places the plots, the buildings and the names of the largest chunks. */
function build() {
  if (!scene) {
    return
  }
  for (const mesh of [buildingMesh, plotMesh, ghostMesh]) {
    if (mesh) {
      scene.remove(mesh)
      mesh.dispose()
    }
  }
  for (const label of labelObjects.splice(0)) {
    label.removeFromParent()
    label.element.remove()
  }
  highlighted = undefined

  plotMesh = instances(city.value.plots, () => PLOT_HEIGHT)
  buildingMesh = instances(city.value.buildings, entry => entry.height)
  buildingMesh.position.y = PLOT_HEIGHT
  ghostMesh = instances(city.value.ghosts, entry => entry.height, ghostMaterial)
  ghostMesh.position.y = PLOT_HEIGHT
  scene.add(plotMesh, buildingMesh, ghostMesh)

  for (const plot of [...city.value.plots].filter(plot => plot.rect.w * plot.rect.h >= LABEL_MIN_AREA).sort((a, b) => Math.max(b.size, b.before ?? 0) - Math.max(a.size, a.before ?? 0)).slice(0, LABELS)) {
    // The plot's rim is too thin to aim at, so its label is the way to open the chunk, unless a
    // change removed it.
    const opens = props.chunks.some(chunk => chunk.file === plot.chunk.file)
    const element = document.createElement(opens ? 'button' : 'span')
    element.className = `rounded-sm bg-default/80 px-1.5 py-0.5 font-mono text-xs text-highlighted ring ring-default whitespace-nowrap ${opens ? 'pointer-events-auto cursor-pointer transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary' : 'line-through decoration-muted'}`
    element.textContent = plot.chunk.file.split('/').pop()!
    if (element instanceof HTMLButtonElement) {
      element.type = 'button'
      element.title = `Open ${element.textContent} in By Chunk`
      element.addEventListener('click', () => emit('openChunk', plot.chunk.file))
    }
    const label = new CSS2DObject(element)
    label.position.set(plot.rect.x + plot.rect.w / 2, PLOT_HEIGHT + plot.height + 1.2, plot.rect.y + plot.rect.h / 2)
    scene.add(label)
    labelObjects.push(label)
  }
  paint()
}

/** Labels are ordered by chunk size, so a smaller chunk's label gives way to a larger one it would cover. */
function hideOverlappingLabels() {
  const shown: DOMRect[] = []
  for (const { element } of labelObjects) {
    const rect = element.getBoundingClientRect()
    // A few pixels of room, so labels never touch.
    const overlaps = shown.some(other => rect.left < other.right + 4 && rect.right + 4 > other.left && rect.top < other.bottom + 4 && rect.bottom + 4 > other.top)
    element.style.visibility = overlaps ? 'hidden' : ''
    if (!overlaps) {
      shown.push(rect)
    }
  }
}

/** How a size changed between the runs, such as `12.4 kB → 8.1 kB (−4.3 kB)`. */
function changeLabel(before: number, after: number) {
  if (before === 0) {
    return `New, ${formatBytes(after)}`
  }
  if (after === 0) {
    return `Removed, was ${formatBytes(before)}`
  }
  return before === after
    ? `${formatBytes(after)}, unchanged`
    : `${formatBytes(before)} → ${formatBytes(after)} (${formatDelta(after - before)})`
}

function loadedLabel(chunk: ChunkInfo) {
  if (!chunk.loadedBy) {
    return undefined
  }
  return chunk.loadedBy === 'all'
    ? 'Loaded on every page'
    : chunk.loadedBy === 'lazy'
      ? 'Loaded on demand'
      : `Loaded before ${chunk.loadedBy.join(', ')} renders`
}

/** What is under the pointer: a building, or the plot of a chunk where no building stands. */
function pick(event: PointerEvent) {
  const bounds = renderer.domElement.getBoundingClientRect()
  pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const [hit] = raycaster.intersectObjects([buildingMesh, ghostMesh, plotMesh].filter(Boolean) as THREE.Object3D[], false)
  if (!hit || hit.instanceId === undefined) {
    return undefined
  }
  return hit.object === buildingMesh
    ? { building: city.value.buildings[hit.instanceId]!, index: hit.instanceId, bounds }
    : hit.object === ghostMesh
      ? { building: city.value.ghosts[hit.instanceId]!, bounds }
      : { plot: city.value.plots[hit.instanceId]!, bounds }
}

function onPointerMove(event: PointerEvent) {
  if (event.buttons) {
    hovered.value = undefined
    return
  }
  const hit = pick(event)
  const index = hit && 'building' in hit
    ? hit.index
    : undefined
  if (index !== highlighted) {
    highlighted = index
    paint()
  }
  renderer.domElement.style.cursor = hit ? 'pointer' : ''
  if (!hit) {
    hovered.value = undefined
    return
  }
  const x = event.clientX - hit.bounds.left
  const y = event.clientY - hit.bounds.top
  if ('building' in hit && hit.building) {
    const { building } = hit
    hovered.value = {
      x,
      y,
      title: building.id.startsWith('node_modules/')
        ? building.id.slice('node_modules/'.length)
        : building.id,
      lines: [
        building.before === undefined
          ? `${formatBytes(building.size)} in ${building.chunk.file.split('/').pop()}`
          : `${changeLabel(building.before, building.size)} in ${building.chunk.file.split('/').pop()}`,
        loadedLabel(building.chunk) ?? '',
      ].filter(Boolean),
    }
  }
  else if ('plot' in hit && hit.plot) {
    hovered.value = {
      x,
      y,
      title: hit.plot.chunk.file.split('/').pop()!,
      lines: [
        hit.plot.before === undefined
          ? formatBytes(hit.plot.size)
          : changeLabel(hit.plot.before, hit.plot.size),
        loadedLabel(hit.plot.chunk) ?? '',
      ].filter(Boolean),
    }
  }
}

// A click opens what is under the pointer; a drag turns the camera instead.
let down: { x: number, y: number } | undefined
function onPointerDown(event: PointerEvent) {
  down = { x: event.clientX, y: event.clientY }
}
function onPointerUp(event: PointerEvent) {
  if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) {
    return
  }
  const hit = pick(event)
  if (hit && 'building' in hit && hit.building?.target) {
    emit('inspect', hit.building.target)
  }
  else if (hit && 'plot' in hit && hit.plot && props.chunks.some(chunk => chunk.file === hit.plot.chunk.file)) {
    emit('openChunk', hit.plot.chunk.file)
  }
}
function onPointerLeave() {
  hovered.value = undefined
  if (highlighted !== undefined) {
    highlighted = undefined
    paint()
  }
}

let observer: ResizeObserver | undefined

onMounted(() => {
  const element = container.value!
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  }
  catch {
    unsupported.value = true
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  element.append(renderer.domElement)
  labels = new CSS2DRenderer()
  labels.domElement.style.position = 'absolute'
  labels.domElement.style.inset = '0'
  labels.domElement.style.pointerEvents = 'none'
  element.append(labels.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1000)
  // From the front corner, far enough that the whole ground fits.
  camera.position.set(92, 96, 122)
  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x444444, 2.2))
  const sun = new THREE.DirectionalLight(0xFFFFFF, 1.6)
  sun.position.set(-60, 120, 40)
  scene.add(sun)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.01
  scene.add(ground)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches
  controls.maxPolarAngle = Math.PI * 0.47
  controls.minDistance = 20
  controls.maxDistance = 320
  controls.listenToKeyEvents(element)
  controls.addEventListener('change', () => {
    dirty = true
  })

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)

  observer = new ResizeObserver(() => {
    const { width, height } = element.getBoundingClientRect()
    renderer.setSize(width, height)
    labels.setSize(width, height)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
    dirty = true
  })
  observer.observe(element)

  build()
  // Renders only when the camera moves or the city changes, so an idle view costs nothing.
  const loop = () => {
    frame = requestAnimationFrame(loop)
    if (controls.update() || dirty) {
      dirty = false
      renderer.render(scene!, camera)
      labels.render(scene!, camera)
      hideOverlappingLabels()
    }
  }
  loop()
})

watch(city, build)
watch(() => [props.search, colorMode.value], () => nextTick(paint))

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  if (!scene) {
    return
  }
  controls.dispose()
  buildingMesh?.dispose()
  plotMesh?.dispose()
  ghostMesh?.dispose()
  ghostMaterial.dispose()
  box.dispose()
  material.dispose()
  ground.geometry.dispose()
  ;(ground.material as THREE.Material).dispose()
  renderer.dispose()
  renderer.domElement.remove()
  labels.domElement.remove()
})
</script>

<template>
  <div
    ref="container"
    tabindex="0"
    role="img"
    :aria-label="base
      ? `A city of the ${env === 'client' ? 'client' : 'Nitro'} build's chunks, colored by how they changed. The same changes are listed in the tables.`
      : `A city of the ${env === 'client' ? 'client' : 'Nitro'} build's ${chunks.length} chunks. The same chunks are listed in By Chunk.`"
    class="relative h-[70vh] min-h-96 overflow-hidden rounded-lg ring ring-default focus-visible:outline-2 focus-visible:outline-primary"
  >
    <UEmpty
      v-if="unsupported"
      icon="i-lucide-box"
      title="3D Needs WebGL"
      description="This browser could not start WebGL. The same chunks are listed in By Chunk."
      class="absolute inset-0"
    />
    <div
      v-if="hovered"
      class="pointer-events-none absolute z-10 max-w-80 rounded-md bg-default px-2.5 py-1.5 text-xs shadow-lg ring ring-default"
      :style="{ left: `${hovered.x + 14}px`, top: `${hovered.y + 14}px` }"
    >
      <p class="break-all font-mono text-highlighted">
        {{ hovered.title }}
      </p>
      <p v-for="line in hovered.lines" :key="line" class="text-muted">
        {{ line }}
      </p>
    </div>
    <div class="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-default/80 px-2.5 py-1.5 text-xs text-muted ring ring-default">
      <template v-if="base">
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-error" />Grew or new</span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-success" />Shrank</span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-success/25 ring ring-success/60" />Removed</span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-(--ui-text-dimmed)/55" />Unchanged</span>
        <span>Area is the larger size of the two</span>
      </template>
      <template v-else>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-primary" />Your code</span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-(--ui-text-muted)" />Dependencies</span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-(--ui-text-dimmed)" />Generated by Nuxt</span>
      </template>
      <span>{{ base ? '' : 'Area is size · ' }}{{ env === 'client' ? 'Height is how many pages load it' : 'Nitro chunks share one height' }}</span>
    </div>
  </div>
</template>
