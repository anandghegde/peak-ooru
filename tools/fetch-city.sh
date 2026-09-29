#!/bin/bash
# Cuts the OpenStreetMap layers that the road network and transit are built from, for the whole game area, out of
# Geofabrik's extract of southern India, and saves them in the shape Overpass gives, which the builders read.
# Overpass will not serve the whole city's main roads in one piece, and the extract is a day old at most.
# Needs osmium-tool (brew install osmium-tool). Usage: tools/fetch-city.sh
set -euo pipefail
dir="$(dirname "$0")/data"; mkdir -p "$dir"
pbf="$dir/southern-zone.osm.pbf"
[ -f "$pbf" ] || curl -sSL --fail -o "$pbf" https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf

osmium extract --overwrite -b 77.35,12.75,77.85,13.20 "$pbf" -o "$dir/city.osm.pbf"
opl() { osmium tags-filter --overwrite "$dir/city.osm.pbf" "${@:2}" -f opl,add_metadata=false -o "$dir/city.$1.opl"; }
# Ways keep their node ids, so that junctions can be told apart from crossings on a flyover.
opl roads w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link
opl signals -R n/highway=traffic_signals
opl transit r/route=subway,light_rail,train w/railway=rail,subway,light_rail,construction,proposed \
  nw/railway=station,halt,stop,construction nw/public_transport=station n/construction:railway=station
date=$(osmium fileinfo -g header.option.timestamp "$pbf")

node - "$dir" "$date" <<'EOF'
const fs = require('fs')
const [dir, date] = process.argv.slice(2)
// OPL escapes characters in tags as %hex%.
const unescape = (s) => s.replace(/%([0-9a-f]+)%/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
function read(name) {
  const nodes = new Map(), ways = new Map(), relations = []
  for (const line of fs.readFileSync(`${dir}/city.${name}.opl`, 'utf8').split('\n')) {
    if (!line) continue
    const fields = Object.fromEntries(line.split(' ').map((f) => [f[0], f.slice(1)]))
    const id = Number(line.slice(1, line.indexOf(' ')))
    const tags = fields.T ? Object.fromEntries(fields.T.split(',').map((kv) => kv.split('=').map(unescape))) : {}
    if (line[0] === 'n') nodes.set(id, { type: 'node', id, lat: Number(fields.y), lon: Number(fields.x), tags })
    if (line[0] === 'w') ways.set(id, { type: 'way', id, nodes: fields.N ? fields.N.split(',').map((n) => Number(n.slice(1))) : [], tags })
    if (line[0] === 'r') {
      const members = (fields.M ? fields.M.split(',') : []).map((m) => {
        const at = m.indexOf('@')
        return { type: { n: 'node', w: 'way', r: 'relation' }[m[0]], ref: Number(m.slice(1, at)), role: unescape(m.slice(at + 1)) }
      })
      relations.push({ type: 'relation', id, tags, members })
    }
  }
  const geometry = (way) => way.nodes.map((n) => nodes.get(n)).filter(Boolean).map(({ lat, lon }) => ({ lat, lon }))
  return { nodes, ways, relations, geometry }
}
const save = (name, elements) =>
  fs.writeFileSync(`${dir}/city.${name}.json`, JSON.stringify({ osm3s: { timestamp_osm_base: date }, elements }))
const tagged = (e) => Object.keys(e.tags).length > 0
const centre = (points) => ({
  lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
  lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
})

const roads = read('roads')
save('roads', [...[...roads.nodes.values()].map(({ tags, ...n }) => n), ...roads.ways.values()])
save('signals', [...read('signals').nodes.values()].filter((n) => n.tags.highway === 'traffic_signals'))

const t = read('transit')
save('routes', t.relations.filter((r) => /^(subway|light_rail|train)$/.test(r.tags.route)).map((r) => ({
  ...r,
  members: r.members.map((m) => {
    if (m.type === 'way' && t.ways.has(m.ref)) return { ...m, geometry: t.geometry(t.ways.get(m.ref)) }
    if (m.type === 'node' && t.nodes.has(m.ref)) return { ...m, lat: t.nodes.get(m.ref).lat, lon: t.nodes.get(m.ref).lon }
    return m
  }),
})))
save('track', [...t.ways.values()]
  .filter((w) => /^(rail|subway|light_rail|construction|proposed)$/.test(w.tags.railway ?? ''))
  .map(({ nodes, ...w }) => ({ ...w, geometry: t.geometry({ nodes }) })))
const isStation = (tags) => /^(station|halt|stop)$/.test(tags.railway ?? '') || tags.public_transport === 'station' ||
  (tags.railway === 'construction' && tags.construction === 'station') || tags['construction:railway'] === 'station'
save('stations', [
  ...[...t.nodes.values()].filter((n) => tagged(n) && isStation(n.tags)),
  ...[...t.ways.values()].filter((w) => isStation(w.tags) && w.nodes.length > 0)
    .map(({ nodes, ...w }) => ({ ...w, center: centre(t.geometry({ nodes })) })),
])
console.log(`saved layers in ${dir}, data of ${date}`)
EOF
