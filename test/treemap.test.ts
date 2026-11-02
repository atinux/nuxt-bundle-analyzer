import { describe, expect, it } from 'vitest'

import { squarify } from '../viewer/app/utils/treemap'

const area = (rect: { w: number, h: number }) => rect.w * rect.h

describe('squarify', () => {
  // Uneven values, out of order and with an empty one, as chunk sizes are.
  const values = [3, 120, 0, 45, 7, 7, 60, 1]
  const rect = { x: 10, y: 20, w: 100, h: 60 }
  const rects = squarify(values, rect)

  it('gives each value an area in proportion to it, in the order of the values', () => {
    const total = values.reduce((sum, value) => sum + value, 0)
    rects.forEach((r, index) => expect(area(r)).toBeCloseTo(area(rect) * values[index]! / total, 6))
  })

  it('fills the rectangle without overlaps or overflow', () => {
    for (const r of rects.filter(r => area(r) > 0)) {
      expect(r.x).toBeGreaterThanOrEqual(rect.x - 1e-9)
      expect(r.y).toBeGreaterThanOrEqual(rect.y - 1e-9)
      expect(r.x + r.w).toBeLessThanOrEqual(rect.x + rect.w + 1e-9)
      expect(r.y + r.h).toBeLessThanOrEqual(rect.y + rect.h + 1e-9)
    }
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) {
        const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        expect(overlap).toBeLessThan(1e-6)
      }
    }
  })

  it('keeps the largest rectangles close to squares', () => {
    const largest = rects[1]!
    expect(Math.max(largest.w / largest.h, largest.h / largest.w)).toBeLessThan(2)
  })
})
