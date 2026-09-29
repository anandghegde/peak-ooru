import type { Map as MapLibre } from 'maplibre-gl'

/** How the English name sits: centred on its point, or to its right. The Kannada name goes under it either way. */
export type KannadaSide = 'below' | 'right'

/** Properties a feature needs for its Kannada name to be drawn: the name, where it is, and how it is laid out. */
export interface KannadaProps {
  kn: string | null
  lng: number
  lat: number
  /** English text size, pixels. */
  size: number
  side: KannadaSide
}

/** Offset of a name set to the right of its point, in ems, as `text-offset` wants it. */
export const RIGHT_OFFSET = 0.8
/** From the middle of the English line to the middle of the Kannada line, in ems of the English. */
const DROP = 1.2

/**
 * Layout that keeps room under an English name for its Kannada one: an invisible icon stretched round the text and
 * down by a line, so that MapLibre keeps other labels out of that space. (A second, transparent line of text would
 * do the same, but its halo shows.)
 */
export function roomBelow(map: MapLibre, size: number): Record<string, unknown> {
  if (!map.hasImage('blank')) map.addImage('blank', { width: 1, height: 1, data: new Uint8Array(4) })
  return {
    'icon-image': 'blank',
    'icon-text-fit': 'both',
    'icon-text-fit-padding': [1, 6, Math.round(size * DROP + 2), 6],
  }
}

/**
 * Kannada names drawn by the browser under the English names MapLibre has placed, since MapLibre cannot shape
 * Kannada. Which names are placed is asked of the map a few times a second; where they are is worked out on every
 * move of the map, in the same frame as the map is drawn, so they do not trail behind it.
 */
export class KannadaLabels {
  private readonly box = document.createElement('div')
  private readonly shown = new Map<string, { el: HTMLElement; props: KannadaProps }>()
  private asked = 0

  /** `layers` are the symbol layers whose placed features carry `KannadaProps`; `from` the zoom they start at. */
  constructor(private readonly map: MapLibre, private readonly layers: { id: string; from: number }[]) {
    this.box.className = 'kannada'
    map.getContainer().appendChild(this.box)
    map.on('move', () => {
      if (performance.now() - this.asked > 250) this.ask()
      this.place()
    })
    map.on('idle', () => {
      this.ask()
      this.place()
    })
  }

  /** How many Kannada names are on screen. */
  get count(): number {
    return this.shown.size
  }

  private ask(): void {
    this.asked = performance.now()
    const zoom = this.map.getZoom()
    const ids = this.layers.filter((l) => zoom >= l.from && this.map.getLayer(l.id)).map((l) => l.id)
    const found = new Set<string>()
    const features = ids.length ? this.map.queryRenderedFeatures({ layers: ids }) : []
    for (const f of features) {
      const props = f.properties as KannadaProps
      if (!props.kn) continue
      const key = `${props.kn}@${props.lng},${props.lat}`
      found.add(key)
      if (this.shown.has(key)) continue
      const el = document.createElement('span')
      el.lang = 'kn'
      el.textContent = props.kn
      el.style.fontSize = `${Math.round(props.size * 0.92)}px`
      this.box.appendChild(el)
      this.shown.set(key, { el, props })
    }
    for (const [key, { el }] of this.shown) {
      if (found.has(key)) continue
      el.remove()
      this.shown.delete(key)
    }
  }

  private place(): void {
    for (const { el, props } of this.shown.values()) {
      const p = this.map.project([props.lng, props.lat])
      const x = props.side === 'right' ? p.x + RIGHT_OFFSET * props.size : p.x
      const y = p.y + DROP * props.size
      const centre = props.side === 'right' ? '0' : '-50%'
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${centre}, -50%)`
    }
  }
}
