export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** How far the rectangles of a row are from squares, the larger of their aspect ratios. */
function worst(areas: number[], side: number) {
  const sum = areas.reduce((total, area) => total + area, 0)
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
}

/**
 * Splits a rectangle into one rectangle per value, each with an area proportional to its value
 * and as close to a square as the others allow (Bruls, Huizing and van Wijk's squarified treemap).
 * Rectangles come back in the order of the values; a value of 0 or less gets an empty one.
 */
export function squarify(values: number[], rect: Rect): Rect[] {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0)
  const out: Rect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }))
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) {
    return out
  }
  const scale = (rect.w * rect.h) / total
  const areas = values.map(value => Math.max(value, 0) * scale)
  // Largest first, which is what keeps the rectangles square.
  const order = areas.map((_, index) => index).filter(index => areas[index]! > 0).sort((a, b) => areas[b]! - areas[a]!)
  let { x, y, w, h } = rect

  const layout = (row: number[]) => {
    const sum = row.reduce((total, index) => total + areas[index]!, 0)
    if (w >= h) {
      // A column along the left side.
      const width = sum / h
      let top = y
      for (const index of row) {
        const height = areas[index]! / width
        out[index] = { x, y: top, w: width, h: height }
        top += height
      }
      x += width
      w -= width
    }
    else {
      // A row along the top side.
      const height = sum / w
      let left = x
      for (const index of row) {
        const width = areas[index]! / height
        out[index] = { x: left, y, w: width, h: height }
        left += width
      }
      y += height
      h -= height
    }
  }

  let row: number[] = []
  for (const index of order) {
    const side = Math.min(w, h)
    const candidate = [...row, index]
    if (row.length === 0 || worst(candidate.map(i => areas[i]!), side) <= worst(row.map(i => areas[i]!), side)) {
      row = candidate
      continue
    }
    layout(row)
    row = [index]
  }
  if (row.length > 0) {
    layout(row)
  }
  return out
}

/** A rectangle shrunk by `inset` on every side, never below nothing. */
export function inset(rect: Rect, inset: number): Rect {
  const dx = Math.min(inset, rect.w / 2)
  const dy = Math.min(inset, rect.h / 2)
  return {
    x: rect.x + dx,
    y: rect.y + dy,
    w: rect.w - dx * 2,
    h: rect.h - dy * 2,
  }
}
