import { east, metres, north } from './geo'

/*
 * Places people know, for naming roads and events in words for the player ("Outer Ring Road, Marathahalli to
 * Bellandur"; "a burst main on Hosur Road near Electronic City"). The rules run without the screen, so they keep their
 * own list: the screen's 37 best-known areas (src/map/places.ts, from OpenStreetMap's place nodes, fetched 28 September
 * 2026, © OpenStreetMap contributors, ODbL), and a few landmarks and towns at the edge that name the roads out of the
 * city. Places in millionths of a degree.
 */
export const AREAS: readonly (readonly [string, number, number])[] = [
  ['Koramangala', 77624100, 12935700],
  ['Indiranagar', 77640500, 12973300],
  ['Whitefield', 77749700, 12969600],
  ['Hebbal', 77591900, 13038200],
  ['Yelahanka', 77596300, 13100700],
  ['Electronic City', 77668700, 12843600],
  ['Jayanagar', 77582400, 12929300],
  ['Malleswaram', 77570300, 13002700],
  ['Rajajinagar', 77554900, 12988200],
  ['Marathahalli', 77698400, 12955300],
  ['KR Puram', 77695900, 13007500],
  ['Kengeri', 77484300, 12923000],
  ['HSR Layout', 77638900, 12911600],
  ['Peenya', 77527300, 13032900],
  ['Yeshwanthpur', 77553100, 13022200],
  ['Banashankari', 77563700, 12926900],
  ['JP Nagar', 77597600, 12911800],
  ['BTM Layout', 77610300, 12914000],
  ['Basavanagudi', 77575500, 12941700],
  ['Shivajinagar', 77605400, 12985500],
  ['Vijayanagar', 77535400, 12966400],
  ['RR Nagar', 77515500, 12927400],
  ['Hennur', 77641400, 13037100],
  ['Bellandur', 77677000, 12929200],
  ['Mahadevapura', 77689700, 12991200],
  ['Gandhinagar', 77580000, 12977200],
  ['Banaswadi', 77651900, 13014200],
  ['Jalahalli', 77548400, 13046500],
  ['Vidyaranyapura', 77557700, 13076600],
  ['RT Nagar', 77595700, 13022700],
  ['Frazer Town', 77613700, 12997600],
  ['Halasuru', 77624700, 12977900],
  ['Domlur', 77638200, 12962500],
  ['Sarjapura', 77786100, 12860100],
  ['Hoskote', 77792100, 13073000],
  ['Nagarabhavi', 77513100, 12966400],
  ['Begur', 77622700, 12874700],  // Landmarks and towns at the edge (positions approximate, to about 300 m).
  ['Silk Board', 77623000, 12917000],
  ['Majestic', 77572000, 12977000],
  ['Manyata', 77620500, 13045000],
  ['the airport', 77706600, 13198600],
  ['Devanahalli', 77710000, 13247000],
  ['Nelamangala', 77393000, 13098000],
  ['Attibele', 77767000, 12778000],
  ['Jigani', 77639000, 12787000],
  ['Bidadi', 77389000, 12796000],
]

const spots = AREAS.map(([, lng, lat]) => [east(lng), north(lat)] as const)

/** The known place nearest a point given in metres east and north (`geo.ts`), and how far it is, in metres. */
export function nearestArea(x: number, y: number): { name: string; metres: number } {
  let best = 0
  let far = Infinity
  spots.forEach(([ax, ay], k) => {
    const d = metres(x, y, ax, ay)
    if (d < far) {
      far = d
      best = k
    }
  })
  return { name: AREAS[best]![0], metres: far }
}
