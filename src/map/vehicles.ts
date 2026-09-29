import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibre } from 'maplibre-gl'
import type { Network } from '../data/types'
import { slot, type TrafficView } from '../game/traffic'

/*
 * Vehicles as small dark dots moving along the main roads, for the look of a living city: more where more traffic
 * runs, slower where it is slow. Nothing is simulated. Each dot is given, once, a stretch, a direction, a place
 * along it and its speed in each part of the day; the graphics card works out where it is in every frame from those
 * and the time, so that the page does no work per dot while it plays.
 */

/** Metres between the points each stretch's line is resampled to, for the graphics card to walk along. */
const SPACING = 30
/** Width of the texture the lines are kept in. */
const WIDTH = 2048
/** Map coordinates are kept relative to the city and scaled up, so that 32-bit floats keep them to the centimetre. */
const SCALE = 1024
/** Seconds of the day that pass in one second of playback, at zoom 11. Closer in, fewer, so dots move at a speed the
 * eye can follow at any zoom. */
const PACE = 45
const COLOUR = [0.149, 0.137, 0.122, 0.85]

const VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform highp sampler2D u_path;
uniform vec4 u_time;
uniform vec4 u_weight;
uniform float u_side;
uniform float u_size;
uniform float u_thin;
uniform float u_minor;
in vec4 a_path;
in vec4 a_kmh;
in vec4 a_share;
in vec4 a_dot;
out float v_alpha;
vec2 at(int i) { return texelFetch(u_path, ivec2(i % ${WIDTH}, i / ${WIDTH}), 0).xy; }
void main() {
  if (a_dot.x >= dot(u_weight, a_share) * u_thin * max(a_dot.w, u_minor)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_alpha = 0.0;
    return;
  }
  float spacing = a_path.z;
  float len = (a_path.y - 1.0) * spacing;
  float d = mod(a_path.w + dot(a_kmh, u_time), len);
  float along = a_dot.y > 0.0 ? d : len - d;
  float f = along / spacing;
  float i = min(floor(f), a_path.y - 2.0);
  int s = int(a_path.x + i);
  vec2 p0 = at(s);
  vec2 p1 = at(s + 1);
  vec2 pos = mix(p0, p1, f - i);
  // On a road drawn as one line for both directions, each direction keeps to its left, as traffic does here.
  vec2 dir = (p1 - p0) / max(length(p1 - p0), 1e-9) * a_dot.y;
  pos += a_dot.z * u_side * vec2(dir.y, -dir.x);
  gl_Position = u_matrix * vec4(pos, 0.0, 1.0);
  gl_PointSize = u_size;
  // Fade in and out at the ends of the stretch, where each dot goes round again.
  float edge = min(0.15 * len, 80.0);
  v_alpha = smoothstep(0.0, edge, d) * (1.0 - smoothstep(len - edge, len, d));
}`

const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 u_colour;
uniform float u_rim;
in float v_alpha;
out vec4 colour;
// A dark dot with a thin pale rim when close in, so that it reads on a red road as on a pale one. With the whole
// city in view the rim is left off, since so many rims would pale the jams' colours.
void main() {
  float r = length(gl_PointCoord - 0.5);
  float inner = mix(0.42, 0.3, u_rim);
  float ink = 1.0 - smoothstep(inner - 0.08, inner, r);
  float rim = (1.0 - smoothstep(0.42, 0.5, r)) * (1.0 - ink) * u_rim;
  vec3 rgb = u_colour.rgb * u_colour.a * ink + vec3(1.0, 0.99, 0.975) * 0.7 * rim;
  colour = vec4(rgb, u_colour.a * ink + 0.7 * rim) * v_alpha;
}`

/** Each stretch's line resampled to even steps, in scaled coordinates relative to `origin`. */
export function resample(network: Network, origin: [number, number]) {
  const first = new Int32Array(network.links.length)
  const count = new Int32Array(network.links.length)
  const spacing = new Float32Array(network.links.length)
  const points: number[] = []
  for (const link of network.links) {
    const xy: number[] = []
    for (let i = 0; i < link.line.length; i += 2) {
      const m = MercatorCoordinate.fromLngLat([link.line[i]!, link.line[i + 1]!])
      xy.push((m.x - origin[0]) * SCALE, (m.y - origin[1]) * SCALE)
    }
    const along = [0]
    for (let i = 2; i < xy.length; i += 2) along.push(along.at(-1)! + Math.hypot(xy[i]! - xy[i - 2]!, xy[i + 1]! - xy[i - 1]!))
    const total = along.at(-1)!
    const n = Math.max(2, Math.ceil(link.length / SPACING) + 1)
    first[link.id] = points.length / 2
    count[link.id] = n
    spacing[link.id] = link.length / (n - 1)
    let k = 0
    for (let j = 0; j < n; j++) {
      const want = (total * j) / (n - 1)
      while (k < along.length - 2 && along[k + 1]! < want) k++
      const span = along[k + 1]! - along[k]!
      const t = span > 0 ? Math.min(1, (want - along[k]!) / span) : 0
      points.push(xy[k * 2]! + (xy[k * 2 + 2]! - xy[k * 2]!) * t, xy[k * 2 + 1]! + (xy[k * 2 + 3]! - xy[k * 2 + 1]!) * t)
    }
  }
  return { first, count, spacing, points: new Float32Array(points) }
}

/**
 * The dots for a month: `budget` of them at most, shared out by the vehicles on each stretch in its busiest part of
 * the day. Each dot carries: where its stretch's points start, how many there are and their spacing, its place along
 * the stretch; its speed in each period; the share of the stretch's dots shown in each period; and its rank among
 * them, its direction, whether the stretch carries both directions on one line, and whether it is a main road (`main`,
 * by stretch id), which alone carries dots with the whole city in view.
 */
export function dots(
  network: Network,
  view: TrafficView,
  path: ReturnType<typeof resample>,
  budget: number,
  main: boolean[],
) {
  const vehicles = new Float32Array(network.links.length * 2)
  let total = 0
  for (const link of network.links) {
    for (const dir of [0, 1] as const) {
      let most = 0
      for (let p = 0; p < 4; p++) most = Math.max(most, view.density[slot(link.id, dir, p)] ?? 0)
      vehicles[link.id * 2 + dir] = (most * link.length) / 1000
      total += vehicles[link.id * 2 + dir]!
    }
  }
  const per = total > 0 ? budget / total : 0
  const data: number[] = []
  let carry = 0
  for (const link of network.links) {
    for (const dir of [0, 1] as const) {
      const want = vehicles[link.id * 2 + dir]! * per + carry
      const n = Math.floor(want)
      carry = want - n
      if (!n) continue
      let most = 0
      for (let p = 0; p < 4; p++) most = Math.max(most, view.density[slot(link.id, dir, p)]!)
      const len = (path.count[link.id]! - 1) * path.spacing[link.id]!
      for (let k = 0; k < n; k++) {
        data.push(path.first[link.id]!, path.count[link.id]!, path.spacing[link.id]!, (len * (k + 0.5)) / n)
        for (let p = 0; p < 4; p++) data.push(view.kmh[slot(link.id, dir, p)]!)
        for (let p = 0; p < 4; p++) data.push(view.density[slot(link.id, dir, p)]! / most)
        // The golden ratio spreads the dots shown in a quiet period evenly along the stretch.
        data.push((k * 0.6180339887) % 1, dir ? -1 : 1, link.oneway ? 0 : 1, main[link.id] ? 1 : 0)
      }
    }
  }
  return new Float32Array(data)
}

const STRIDE = 16

/** The dots, drawn as one batch by the graphics card. */
export class VehicleLayer implements CustomLayerInterface {
  readonly id = 'vehicles'
  readonly type = 'custom'
  readonly renderingMode = '2d'
  private map!: MapLibre
  private gl!: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private buffer: WebGLBuffer | null = null
  private texture: WebGLTexture | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private count = 0
  private readonly origin: [number, number]
  private readonly path: ReturnType<typeof resample>
  /** Seconds of the day passed in each period so far, times the pace: where the dots are. */
  readonly time = new Float32Array(4)
  /** How much each period shows: one at a time, with a short blend between. */
  readonly weight = new Float32Array([1, 0, 0, 0])
  visible = false

  /** `main` says, by stretch id, which stretches are main roads. */
  constructor(
    private readonly network: Network,
    private readonly main: boolean[],
  ) {
    const centre = MercatorCoordinate.fromLngLat([77.6, 12.97])
    this.origin = [centre.x, centre.y]
    this.path = resample(network, this.origin)
  }

  /** How many dots are loaded. */
  get dots(): number {
    return this.count
  }

  onAdd(map: MapLibre, gl: WebGL2RenderingContext): void {
    this.map = map
    this.gl = gl
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, source)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const program = gl.createProgram()!
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
    this.program = program
    const names = ['u_matrix', 'u_path', 'u_time', 'u_weight', 'u_side', 'u_size', 'u_thin', 'u_minor', 'u_colour', 'u_rim']
    for (const name of names) {
      this.uniforms[name] = gl.getUniformLocation(program, name)
    }
    const { points } = this.path
    const rows = Math.ceil(points.length / 2 / WIDTH)
    const texels = new Float32Array(WIDTH * rows * 2)
    texels.set(points)
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, WIDTH, rows, 0, gl.RG, gl.FLOAT, texels)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.buffer = gl.createBuffer()
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const attributes: [string, number, number][] = [['a_path', 4, 0], ['a_kmh', 4, 4], ['a_share', 4, 8], ['a_dot', 4, 12]]
    for (const [name, size, offset] of attributes) {
      const at = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(at)
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, STRIDE * 4, offset * 4)
    }
    gl.bindVertexArray(null)
  }

  /** Loads the dots for a month's traffic, `budget` at most. */
  load(view: TrafficView, budget: number): void {
    const data = dots(this.network, view, this.path, budget, this.main)
    this.count = data.length / STRIDE
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  }

  /** Moves the dots on by `seconds` of playback. */
  advance(seconds: number): void {
    const zoom = this.map.getZoom()
    // Seconds of the day, as metres a km/h covers: 1 km/h is 1/3.6 metres a second.
    const step = (seconds * PACE * 2 ** (11 - Math.min(zoom, 16))) / 3.6
    for (let p = 0; p < 4; p++) this.time[p] = this.time[p]! + step * this.weight[p]!
  }

  render(gl: WebGL2RenderingContext, options: Parameters<CustomLayerInterface['render']>[1]): void {
    if (!this.visible || !this.count || !this.program) return
    const zoom = this.map.getZoom()
    const ratio = this.map.getPixelRatio()
    const m = options.defaultProjectionData.mainMatrix as ArrayLike<number>
    // The map's matrix, moved to the city's origin and scaled, worked out in double precision.
    const [ox, oy] = this.origin
    const matrix = new Float32Array(16)
    for (let r = 0; r < 4; r++) {
      matrix[r] = m[r]! / SCALE
      matrix[4 + r] = m[4 + r]! / SCALE
      matrix[8 + r] = m[8 + r]!
      matrix[12 + r] = m[0 + r]! * ox + m[4 + r]! * oy + m[12 + r]!
    }
    const worldPerPixel = SCALE / (512 * 2 ** zoom)
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uniforms.u_matrix!, false, matrix)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.uniform1i(this.uniforms.u_path!, 0)
    gl.uniform4fv(this.uniforms.u_time!, this.time)
    gl.uniform4fv(this.uniforms.u_weight!, this.weight)
    gl.uniform1f(this.uniforms.u_side!, zoom < 13 ? 0 : 1.6 * worldPerPixel)
    gl.uniform1f(this.uniforms.u_size!, ratio * (zoom < 12 ? 2.2 : zoom < 14 ? 3.6 : 4.6))
    gl.uniform1f(this.uniforms.u_rim!, Math.min(1, Math.max(0, zoom - 12)))
    // With the whole city in view, fewer dots, so that they read as traffic and not as ink.
    gl.uniform1f(this.uniforms.u_thin!, Math.min(1, 0.35 * 2 ** ((zoom - 11) / 2)))
    // Dots on the lesser roads come in as the streets do.
    gl.uniform1f(this.uniforms.u_minor!, Math.min(1, Math.max(0, zoom - 11.5)))
    gl.uniform4fv(this.uniforms.u_colour!, COLOUR)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.POINTS, 0, this.count)
    gl.bindVertexArray(null)
  }

  onRemove(_map: MapLibre, gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.program)
    gl.deleteBuffer(this.buffer)
    gl.deleteTexture(this.texture)
    gl.deleteVertexArray(this.vao)
  }
}
