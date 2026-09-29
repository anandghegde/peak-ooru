import type { Map as MapLibre } from 'maplibre-gl'
import { roomBelow } from './kannada'

/** An area of the city that people know by name, drawn in English and Kannada. */
export interface KnownPlace {
  en: string
  /** Its name in OpenStreetMap, which the base map's own labels use; those are hidden in favour of this one. */
  osm: string
  kn: string | null
  /** 1 is shown with the whole city in view, 3 only closer in. */
  rank: 1 | 2 | 3
  at: [number, number]
}

/**
 * The areas the player most needs to find their way. The choice of names is ours; the Kannada names and the
 * positions are OpenStreetMap's place nodes (fetched 2026-09-28, © OpenStreetMap contributors, ODbL).
 */
export const KNOWN_PLACES: KnownPlace[] = [
  // Shown with the whole city in view: the 25 names the city is known by.
  { en: 'Koramangala', osm: 'Koramangala', kn: 'ಕೋರಮಂಗಲ', rank: 1, at: [77.6241, 12.9357] },
  { en: 'Indiranagar', osm: 'Indiranagar', kn: 'ಇಂದಿರಾನಗರ', rank: 1, at: [77.6405, 12.9733] },
  { en: 'Whitefield', osm: 'Whitefield', kn: 'ವೈಟ್‌ಫೀಲ್ಡ್', rank: 1, at: [77.7497, 12.9696] },
  { en: 'Hebbal', osm: 'Hebbal', kn: 'ಹೆಬ್ಬಾಳು', rank: 1, at: [77.5919, 13.0382] },
  { en: 'Yelahanka', osm: 'Yelahanka', kn: 'ಯಲಹಂಕ', rank: 1, at: [77.5963, 13.1007] },
  { en: 'Electronic City', osm: 'Electronic City', kn: 'ಇಲೆಕ್ಟ್ರಾನಿಕ್ ಸಿಟಿ', rank: 1, at: [77.6687, 12.8436] },
  { en: 'Jayanagar', osm: 'Jayanagar', kn: 'ಜಯನಗರ', rank: 1, at: [77.5824, 12.9293] },
  { en: 'Malleswaram', osm: 'Malleswaram', kn: 'ಮಲ್ಲೇಶ್ವರಂ', rank: 1, at: [77.5703, 13.0027] },
  { en: 'Rajajinagar', osm: 'Rajajinagar', kn: 'ರಾಜಾಜಿನಗರ', rank: 1, at: [77.5549, 12.9882] },
  { en: 'Marathahalli', osm: 'Marathahalli', kn: 'ಮಾರತಹಳ್ಳಿ', rank: 1, at: [77.6984, 12.9553] },
  { en: 'KR Puram', osm: 'KR Puram', kn: 'ಕೃಷ್ಣರಾಜಪುರ', rank: 1, at: [77.6959, 13.0075] },
  { en: 'Kengeri', osm: 'Kengeri', kn: 'ಕೆಂಗೇರಿ', rank: 1, at: [77.4843, 12.923] },
  { en: 'HSR Layout', osm: 'HSR Layout', kn: 'ಎಚ್ಎಸ್ಆರ್ ಲೇಔಟ್', rank: 1, at: [77.6389, 12.9116] },
  { en: 'Peenya', osm: 'Peenya', kn: 'ಪೀಣ್ಯ', rank: 1, at: [77.5273, 13.0329] },
  { en: 'Yeshwanthpur', osm: 'Yeswanthpur', kn: 'ಯಶ್ವಂತಪುರ', rank: 1, at: [77.5531, 13.0222] },
  { en: 'Banashankari', osm: 'Banashankari 2nd Stage', kn: 'ಬನಶಂಕರಿ', rank: 1, at: [77.5637, 12.9269] },
  { en: 'JP Nagar', osm: 'JP Nagar 3rd Phase', kn: 'ಜೆಪಿ ನಗರ', rank: 1, at: [77.5976, 12.9118] },
  { en: 'BTM Layout', osm: 'BTM Layout', kn: 'ಬಿಟಿಎಂ ಲೇಔಟ್', rank: 1, at: [77.6103, 12.914] },
  { en: 'Basavanagudi', osm: 'Basavanagudi', kn: 'ಬಸವನಗುಡಿ', rank: 1, at: [77.5755, 12.9417] },
  { en: 'Shivajinagar', osm: 'Shivajinagar', kn: 'ಶಿವಾಜಿನಗರ', rank: 1, at: [77.6054, 12.9855] },
  { en: 'Vijayanagar', osm: 'Vijaya Nagar', kn: 'ವಿಜಯನಗರ', rank: 1, at: [77.5354, 12.9664] },
  { en: 'RR Nagar', osm: 'Rajarajeshwari Nagar', kn: 'ರಾಜರಾಜೇಶ್ವರಿ ನಗರ', rank: 1, at: [77.5155, 12.9274] },
  { en: 'Hennur', osm: 'Hennur', kn: 'ಹೆಣ್ಣೂರು', rank: 1, at: [77.6414, 13.0371] },
  { en: 'Bellandur', osm: 'Bellanduru', kn: 'ಬೆಳ್ಳಂದೂರು', rank: 1, at: [77.677, 12.9292] },
  { en: 'Mahadevapura', osm: 'Mahadevapura', kn: 'ಮಹಾದೇವಪುರ', rank: 1, at: [77.6897, 12.9912] },
  // Shown a little closer in.
  { en: 'Gandhinagar', osm: 'Gandhinagar', kn: 'ಗಾಂಧಿನಗರ', rank: 2, at: [77.58, 12.9772] },
  { en: 'Banaswadi', osm: 'Banaswadi', kn: 'ಬಾಣಸವಾಡಿ', rank: 2, at: [77.6519, 13.0142] },
  { en: 'Jalahalli', osm: 'Jalahalli', kn: 'ಜಾಲಹಳ್ಳಿ', rank: 2, at: [77.5484, 13.0465] },
  { en: 'Vidyaranyapura', osm: 'Vidyaranyapura', kn: 'ವಿದ್ಯಾರಣ್ಯಪುರ', rank: 2, at: [77.5577, 13.0766] },
  { en: 'RT Nagar', osm: 'RT Nagar', kn: 'ರವೀಂದ್ರನಾಥ ಠಾಗೋರ್ ನಗರ', rank: 2, at: [77.5957, 13.0227] },
  { en: 'Frazer Town', osm: 'Frazer Town', kn: 'ಫ್ರೇಜರ್ ಟೌನ್', rank: 2, at: [77.6137, 12.9976] },
  { en: 'Halasuru', osm: 'Halasuru', kn: 'ಹಲಸೂರು', rank: 2, at: [77.6247, 12.9779] },
  { en: 'Domlur', osm: 'Domlur', kn: 'ದೊಮ್ಮಲೂರು', rank: 2, at: [77.6382, 12.9625] },
  { en: 'Sarjapura', osm: 'Sarjapura', kn: 'ಸರ್ಜಾಪುರ', rank: 2, at: [77.7861, 12.8601] },
  { en: 'Hoskote', osm: 'Hoskote', kn: 'ಹೊಸಕೋಟೆ', rank: 2, at: [77.7921, 13.073] },
  { en: 'Nagarabhavi', osm: 'Nagarabhavi', kn: 'ನಾಗರಭಾವಿ', rank: 2, at: [77.5131, 12.9664] },
  { en: 'Begur', osm: 'Beguru', kn: 'ಬೇಗೂರು', rank: 2, at: [77.6227, 12.8747] },
  // Shown closer still.
  { en: 'Chikkapete', osm: 'Chikkapete', kn: 'ಚಿಕ್ಕಪೇಟೆ', rank: 3, at: [77.5757, 12.9698] },
  { en: 'Sadashivanagar', osm: 'Sadashivanagar', kn: 'ಸದಾಶಿವನಗರ', rank: 3, at: [77.5809, 13.011] },
  { en: 'Vasanth Nagar', osm: 'Vasanth Nagar', kn: 'ವಸಂತ ನಗರ', rank: 3, at: [77.5915, 12.9922] },
  { en: 'Wilson Garden', osm: 'Wilson Garden', kn: 'ವಿಲ್ಸನ್ ಗಾರ್ಡನ್', rank: 3, at: [77.5968, 12.9489] },
  { en: 'Madiwala', osm: 'Madiwala', kn: 'ಮಡಿವಾಳ', rank: 3, at: [77.6176, 12.9238] },
  { en: 'Bommanahalli', osm: 'Bommanahalli', kn: 'ಬೊಮ್ಮನಹಳ್ಳಿ', rank: 3, at: [77.6239, 12.9089] },
  { en: 'Hulimavu', osm: 'Hulimavu', kn: 'ಹುಳಿಮಾವು', rank: 3, at: [77.6028, 12.8773] },
  { en: 'Kudlu', osm: 'Kudlu', kn: 'ಕುಡ್ಲು', rank: 3, at: [77.6556, 12.8889] },
  { en: 'Varthur', osm: 'Varthur', kn: 'ವರ್ತೂರು', rank: 3, at: [77.747, 12.9407] },
  { en: 'Kadugodi', osm: 'Kadugodi', kn: 'ಕಾಡುಗೋಡಿ', rank: 3, at: [77.761, 12.9986] },
  { en: 'Hoodi', osm: 'Hoodi', kn: 'ಹೂಡಿ', rank: 3, at: [77.7162, 12.9919] },
  { en: 'Brookefield', osm: 'Brookefield', kn: 'ಬ್ರೂಕ್ ಫೀಲ್ಡ್ಸ್', rank: 3, at: [77.7179, 12.9652] },
  { en: 'Uttarahalli', osm: 'Uttarahalli', kn: 'ಉತ್ತರಹಳ್ಳಿ', rank: 3, at: [77.5455, 12.9056] },
  { en: 'Basaveshwaranagar', osm: 'Basaveshwaranagar', kn: 'ಬಸವೇಶ್ವರ ನಗರ', rank: 3, at: [77.5391, 12.9938] },
  { en: 'Thanisandra', osm: 'Thanisandra', kn: 'ಥಣಿಸಂದ್ರ', rank: 3, at: [77.6339, 13.0547] },
  { en: 'Jakkur', osm: 'Jakkur', kn: 'ಜಕ್ಕೂರು', rank: 3, at: [77.6069, 13.0785] },
  { en: 'Kalyan Nagar', osm: 'Kalyan Nagar', kn: 'ಕಲ್ಯಾಣನಗರ', rank: 3, at: [77.6403, 13.0221] },
  { en: 'Kammanahalli', osm: 'Kammanahalli', kn: 'ಕಮ್ಮನಹಳ್ಳಿ', rank: 3, at: [77.6382, 13.0149] },
  { en: 'Nagavara', osm: 'Nagavara', kn: 'ನಾಗವಾರ', rank: 3, at: [77.6236, 13.0375] },
  { en: 'Sahakaranagar', osm: 'Sahakaranagara', kn: 'ಸಹಕಾರನಗರ', rank: 3, at: [77.5859, 13.0629] },
  { en: 'Mathikere', osm: 'Mathikere', kn: 'ಮತ್ತಿಕೆರೆ', rank: 3, at: [77.5582, 13.0334] },
  { en: 'Bommasandra', osm: 'Bommasandra', kn: 'ಬೊಮ್ಮಸಂದ್ರ', rank: 3, at: [77.6916, 12.8162] },
  { en: 'Shanti Nagar', osm: 'Shanti Nagar', kn: 'ಶಾಂತಿನಗರ', rank: 3, at: [77.5924, 12.9555] },
  { en: 'Padmanabhanagar', osm: 'Padmanabha Nagar', kn: 'ಪದ್ಮನಾಭ ನಗರ', rank: 3, at: [77.5561, 12.9163] },
  { en: 'Kumaraswamy Layout', osm: 'Kumaraswamy Layout', kn: 'ಕುಮಾರಸ್ವಾಮಿ ಬಡಾವಣೆ', rank: 3, at: [77.5595, 12.9068] },
  { en: 'Ejipura', osm: 'Ejipura', kn: 'ಈಜಿಪುರ', rank: 3, at: [77.6275, 12.9452] },
  { en: 'Seshadripuram', osm: 'Seshadripuram', kn: 'ಶೇಷಾದ್ರಿಪುರಂ', rank: 3, at: [77.5753, 12.9932] },
  { en: 'Cox Town', osm: 'Cox Town', kn: 'ಕಾಕ್ಸ್ ಟೌನ್', rank: 3, at: [77.6239, 12.9955] },
  { en: 'HBR Layout', osm: 'HBR Layout', kn: 'ಎಚ್‌ಬಿಆರ್ ಲೇಔಟ್', rank: 3, at: [77.6281, 13.032] },
  { en: 'Nelamangala', osm: 'Nelamangala', kn: 'ನೆಲಮಂಗಲ', rank: 3, at: [77.3964, 13.0953] },
  { en: 'Attibele', osm: 'Attibele', kn: 'ಅತ್ತಿಬೆಲೆ', rank: 3, at: [77.7713, 12.7783] },
  { en: 'Jigani', osm: 'Jigani', kn: 'ಜಿಗಣಿ', rank: 3, at: [77.6381, 12.7853] },
  { en: 'Sanjaynagar', osm: 'Sanjay Nagara', kn: 'ಸಂಜಯನಗರ', rank: 3, at: [77.578, 13.0365] },
]

const SIZES = { 1: 14, 2: 12.5, 3: 11.5 }
/** The zoom at which each rank of name first shows. */
export const PLACE_ZOOMS = { 1: 0, 2: 11.8, 3: 12.8 }

/** Draws the known places' English names, with room under each for its Kannada name. */
export function addPlaces(map: MapLibre, labelColour: string, halo: string): { id: string; from: number }[] {
  map.addSource('places', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: KNOWN_PLACES.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p.at },
        properties: {
          en: p.en,
          kn: p.kn,
          lng: p.at[0],
          lat: p.at[1],
          size: SIZES[p.rank],
          side: 'below',
          rank: p.rank,
        },
      })),
    },
  })
  // Rank 1 last, so that it is on top, and MapLibre places it first when names compete for room.
  return ([3, 2, 1] as const).map((rank) => {
    const id = `places-${rank}`
    map.addLayer({
      id,
      type: 'symbol',
      source: 'places',
      minzoom: PLACE_ZOOMS[rank],
      filter: ['==', ['get', 'rank'], rank],
      layout: {
        ...roomBelow(map, SIZES[rank]),
        'text-field': ['get', 'en'],
        'text-font': [rank === 1 ? 'Noto Sans Medium' : 'Noto Sans Regular'],
        'text-size': SIZES[rank],
        'text-padding': 6,
        'text-max-width': 40,
      },
      paint: {
        'text-color': labelColour,
        'text-halo-color': halo,
        'text-halo-width': 1.4,
        // Each rank comes in by degrees, not all at once.
        'text-opacity': ['interpolate', ['linear'], ['zoom'], PLACE_ZOOMS[rank], 0, PLACE_ZOOMS[rank] + 0.5, 1],
      },
    })
    return { id, from: 0 }
  })
}
