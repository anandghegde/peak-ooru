# Peak Ooru — where the zones come from

This document covers the zones: their outlines, and the people, jobs and income level of each. It is written for
whoever decides whether the game may be published, and for whoever next rebuilds the data. Roads and transit are in
the same position (OpenStreetMap, ODbL) and are not repeated here.

Built by `tools/fetch-zones.sh` (downloads) and `tools/build-zones.ts` (the build), into `public/data/zones.json`
(figures) and `public/data/zones.geojson` (outlines). Written 28 September 2026.

## In short

- **Boundaries: the current wards, not old ones.** The 369 wards of the Greater Bengaluru Authority's five city
  corporations, as finally notified on 19 November 2025 with the ward renamings of 1 December 2025. This is the newest
  ward map there is. Published on OpenCity with the licence "Other (Public Domain)"; OpenCity's site-wide terms say its
  data is under the ODbL and should be credited to OpenCity. Either way the game may use it, with a credit line.
- **Outside the wards** (73% of the game's area), 42 coarse zones built from OpenStreetMap village boundaries (ODbL).
- **Every figure is a game value resting on approximate data.** No one has counted anyone in Bengaluru since the 2011
  census. People in 2026 are an estimate; jobs by ward are an estimate from the map; income level is a ranking from
  2011 household assets. The game must say so, as PRD section 16 already requires.
- **Credits the game must show** (see the last section): OpenStreetMap contributors; OpenCity and the Greater
  Bengaluru Authority; the European Commission's GHSL; the Census of India 2011.

| Figure | From | Date of data | Licence | Trust |
|---|---|---|---|---|
| Ward outlines, names (English, Kannada) | Greater Bengaluru Authority, via OpenCity | Notified 19 Nov 2025, names 1 Dec 2025 | Public domain (dataset) / ODbL (site) | Good: the official map |
| Outer zone outlines and names | OpenStreetMap village boundaries and places | Extract of 27 Sep 2026 | ODbL | Fair: village lines as mapped; grouping is ours |
| People, 2026 | Census 2011 by ward, grown with GHSL grids | 2011, modelled to 2026 | Census: government data via OpenCity (public domain); GHSL: CC BY 4.0 | Rough: city total ±15%, a single ward ±30% or worse |
| Jobs | OpenStreetMap workplaces and GHSL non-home building volume, scaled to the 2011 share of workers | Map 2026, buildings 2020, share 2011 | ODbL, CC BY 4.0 | Rough: the pattern is right, a single zone may be out by half |
| Income, 1 to 5 | Census 2011 household assets (car, computer with internet) by ward and village | 2011 | Government data via OpenCity (public domain) | Fair as a ranking, fifteen years old |
| Area | Computed from the outlines | — | — | Good |
| Centre, road junction | Computed; junction from A's `network.json` | — | — | Good |

## 1. Boundaries

### What happened to the wards

All dated from published notices or reporting; secondary sources are marked.

| Date | Event | Source |
|---|---|---|
| 15 May 2025 | The Greater Bengaluru Governance Act, 2024 (Karnataka Act 36 of 2025) came into force, by notification UDD 100 BBS 2025 P-2 of 14 May 2025. The Greater Bengaluru Authority replaced the BBMP. | [Act text](https://www.indiacode.nic.in/bitstream/123456789/21664/1/36_of_2025_(e).pdf); [South First](https://thesouthfirst.com/karnataka/bbmp-is-now-greater-bengaluru-authority-karnataka-government-notifies-change/) (secondary) |
| 2 Sep 2025 | Five city corporations constituted: Central, East, North, South, West. | [Deccan Herald](https://www.deccanherald.com/india/karnataka/bengaluru/gba-is-born-5-corporations-to-govern-city-heads-named-3709253) (secondary) |
| 30 Sep 2025 | Draft ward delimitation: 368 wards, drawn on 2011 census population. Objections to 15 Oct. | [OpenCity dataset](https://data.opencity.in/dataset/gba-wards-delimitation-2025) |
| 19 Nov 2025 | Final notification: 369 wards (Central 63, East 50, North 72, South 72, West 112). | [OpenCity resource](https://data.opencity.in/dataset/gba-wards-delimitation-2025/resource/dbe57ae6-a72f-426e-917b-e55b3b22a87b); [South First](https://thesouthfirst.com/karnataka/karnataka-approves-369-wards-under-gba-raising-hopes-for-long-delayed-civic-polls/) |
| 1 Dec 2025 | Thirteen wards renamed (among them "Akash" back to "Aerocity"). | Renaming notices on the OpenCity dataset; [Deccan Herald](https://www.deccanherald.com/india/karnataka/bengaluru/karnataka-govt-drops-akash-ward-after-objections-renames-13-areas-3817785) |
| 7 Mar 2026 | Ward reservations published; boundaries unchanged. | [OpenCity](https://data.opencity.in/dataset/gba-ward-wise-reservations-2026) |
| Sep 2026 | Corporation elections not yet held; reported deadlines conflict. Boundaries could change again before or after. | Research summary, not confirmed |

The belief in the brief was right: the authority came into force in 2025, with five corporations and new wards.

### Sources found

| Source | Date | Wards | Area covered | Licence | Used? |
|---|---|---|---|---|---|
| **GBA final wards with population, KML, on OpenCity** ([link](https://data.opencity.in/dataset/gba-wards-delimitation-2025/resource/9013d656-8051-4e2d-9648-46efd0d86d3d)) | Nov–Dec 2025 | 369 | The five corporations, 719 km² by our measure (Wikipedia gives 712 km²; press reports 721 km²) | Dataset: "Other (Public Domain)". Site FAQ: "All our data is under ODbL", credit OpenCity | **Yes** |
| OpenStreetMap, `boundary=administrative`, `admin_level=10` | Mapped 2025–26 | 369 in the game's area | Same wards | ODbL | No: the same wards traced by volunteers; the official file is the primary source and carries fewer obligations |
| OpenStreetMap, `admin_level=9` (villages) | As mapped | 483 in the game's area | Much of the rural ring; parts of Bengaluru Rural and Tamil Nadu are unmapped | ODbL | Yes, for the outer zones |
| OpenStreetMap, `admin_level=8` / `6` | As mapped | 5 corporations / taluks | | ODbL | No |
| OpenCity "BBMP Ward Information": 198 wards (2015), 243 (2022), 225 (2023) | 2015–2023 | 198 / 243 / 225 | Old BBMP | None given | 198-ward map used only inside the build, to carry 2011 census assets onto the new wards. Not published. |
| DataMeet `Municipal_Spatial_Data/Bangalore` | 2012 and 2022 | ~198 and 243 | Old BBMP | CC BY-SA 2.5 India (folder README; repo default is CC BY 4.0) | No: superseded |
| KSRSAC K-GIS portal | Current | Various | Karnataka | No open licence found; disclaimer only | No |
| data.gov.in, Karnataka open data portal | — | No ward boundary files found | — | GODL-India | No |

**Why the GBA file:** it is the current, official delimitation; it carries Kannada ward names and each ward's 2011
census population; and it is openly licensed. **Its weakness:** the licence tag and OpenCity's general terms disagree.
Reading the stricter one (ODbL, credit OpenCity) costs the game nothing it is not already doing for OpenStreetMap.

The outlines were not changed except to simplify them (below). Ward names are as notified, including suffixes such as
"Ward" in "Sangolli Rayanna Ward".

### The rest of the map

The game's area (77.35–77.85 E, 12.75–13.20 N, about 2,700 km²) is almost four times the wards. Leaving it out would
leave Electronic City, Bommasandra, Jigani, Hoskote, Sarjapura and Nelamangala without people or jobs, and they are
among the region's biggest workplaces and fastest-growing suburbs. So it is covered, coarsely:

1. The ground outside the wards is cut along OpenStreetMap village boundaries (`admin_level=9`).
2. Ground with no mapped village (much of Hoskote taluk, parts of Nelamangala and the Tamil Nadu corner) is cut by
   which OpenStreetMap place (city, town, suburb or village) is nearest.
3. Pieces are joined, smallest first into their smallest neighbour, until each zone holds about 150,000 people or 50 km².

This gives 42 outer zones of 15 to 85 km², each named after the biggest town or suburb in it, else its most populous
village. Trips from further away enter by the gateways on the main roads that A marks.

### Simplification

Outlines are simplified together with mapshaper (Visvalingam, weighted, 15% of points kept), which keeps shared borders
shared, then cleaned of slivers under about 75 m wide, and written with coordinates to five decimal places (about 1 m).
`zones.geojson` is 505 KB, 109 KB compressed; `zones.json` is 86 KB, 20 KB compressed.

## 2. People

**What the player sees:** people living in the zone in January 2026. Total 16.45 million on the whole map: 12.45
million in the 369 wards, 4.0 million outside.

**There is no count for 2026.** India's 2021 census was not held; the last ward counts are from 2011. The method:

1. **Start, 2011.** For each ward, the 2011 census population the delimitation used (8,402,887 in all; the BBMP's 2011
   census total was 8,443,675). For the outer zones, the GHSL population grid for 2011 (1.67 million).
2. **Growth everywhere.** Every zone grows by 12% over the fifteen years: natural increase and more people in the same
   homes. This is an assumption; urban Karnataka's natural increase is under one per cent a year.
3. **Growth where homes were built.** The rest of the growth goes to where the volume of homes grew between 2010 and
   2020, in the GHSL built-volume grids (all buildings, less those classed as not homes). About 0.012 extra residents
   per cubic metre of new homes.
4. **Total.** The whole map is made to hold what the GHSL population grid gives for it in 2026 (straight-line between
   its 2025 and 2030 layers): 16.45 million.

**Why this way.** The GHSL grid's total is the best open, dated, modelled figure we found, and matches the range in
press and court filings (about 13 to 14.4 million for the corporation area, not verified at source). But the grid's
spread inside the city is wrong for Bengaluru: it puts about half as many people again in the old core as the census
does (1.70 million against 1.13 million within 4 km of the centre) and very few in Koramangala or Whitefield, and its
own growth from 2011 is fastest in the core. So we keep the census's ward pattern and add growth where homes were built.

The result behaves as the city did: the old core (Padarayanapura, Chickpete) grows 12–15%; outer wards on the
Sarjapura Road, Whitefield and Bellandur side grow two to four and a half times (Bellanduru 16,700 → 51,500;
Kasavanahalli 21,300 → 96,000, the most populous ward). Wards range from 17,000 to 96,000 people, median 30,000.

**Rejected:** WorldPop Global2 R2025A (CC BY 4.0) has a more believable spread inside the city but grows every part of
it by the same 8% from 2015 to 2026 and puts only 9.4 million on the whole map; it follows India's national growth, not
Bengaluru's.

**Trust.** The map total could be out by 15% either way. A ward's figure rests on its 2011 count (good) and on
satellite-measured building growth (rough); treat it as within 30%, worse where towers went up after 2020 (the grids
stop there) or where new building was offices counted as homes. The outer zones rest on the GHSL grid for 2011 as well,
which is weaker still.

## 3. Jobs

**What the player sees:** jobs located in the zone. Total 7.24 million: 4.91 million in the wards, 2.33 million outside.

**There is no open count of jobs by ward or zone.** The method:

1. **Total.** 44% of the people on the map: Bangalore district's workers in the 2011 census were 4,246,927 of
   9,621,551 (44.1%; figure from a census summary site, not the census tables themselves). This assumes the share has
   held and that jobs on the map roughly equal workers living on it; commuting in from beyond the map is ignored.
2. **Local jobs**, 12% of residents, stay where people live: corner shops, domestic work, building sites, street trade.
3. **The rest** (5.26 million) is shared out between zones, half by each of two independent measures, so that neither
   decides a zone alone:
   - **Mapped workplaces in OpenStreetMap.** Land tagged commercial or retail at 250 jobs a hectare, industrial at 120
     where it is built up (below), named tech parks under 80 ha (Manyata, Embassy TechVillage, Bagmane and others
     matched by name) at 1,500, one company's own campus (Infosys, Wipro, HCL, Oracle and the like, and the biotech
     parks) at 900, and the airport's land at 20; plus each mapped office (40 jobs, 60 for government),
     hospital (300), university (400), college (80), school (40), market (100), hotel (40), shop (3), restaurant (8) and
     so on. These weights are our judgement; they add up to 3.6 million before scaling, close to what is needed.
   - **Building volume not used for homes** in the GHSL 2020 grid: 320 million m³ on the map, about 44 m³ per job,
     which is a believable office-and-shop floor space per worker. On industrial land a cubic metre counts a quarter as
     much (below): 224 million m³ so weighted.

**Industrial estates, revised 28 September 2026 (slice 4).** The first build counted industrial land by its area alone,
and its buildings as if they were offices, so large estates at the edge of the city came out with too many jobs
(Electronic City and Bommasandra 434,000 between them, Jigani 184,000 on single-lane roads). Two changes, both
judgement, the city's total kept:
1. *By how full it is.* An estate has its 120 jobs a hectare only where it has 20,000 m³ of buildings not homes a
   hectare (GHSL 2020), as the busier estates do, and fewer in proportion where it is emptier: KIADB's newer estates are
   partly plots not yet built on. Mapped industrial land came to 1.25 million jobs before scaling by area, 0.66 million
   by how full it is.
2. *Sheds are roomy.* On industrial land a cubic metre of building counts a quarter as many jobs as elsewhere: sheds
   and warehouses give a worker perhaps 40 to 80 m² under 6 to 10 m of roof, an office 10 to 15 m² under 3.5 m.
3. *Campuses are low.* A single company's campus is counted at 900 jobs a hectare, not 1,500: Infosys's Electronic City
   campus is mapped at 29 ha, which at 1,500 would hold 43,000; a park of towers let to many firms (Manyata,
   Embassy TechVillage, Prestige Tech Park) keeps 1,500.

What changed, jobs: Jigani 183,726 → 131,348; Bommasandra 160,982 → 123,150; Chagalatti (the airport's aerospace and
hardware parks) 101,951 → 38,452; Peenya 98,423 → 75,374; the other outer industrial zones (Bedarapalli, Shivapura,
Suryanagar, Chokkahalli, Madanayakanahalli, Thirumalashettihalli) down by a quarter to two fifths. The jobs went to the
offices and shops: Electronic City 272,579 → 288,497 (its jobs are offices), Panathur 145,076 → 181,893, Kempapura
140,463 → 175,431, Ashokanagar, Sampangirama Nagar, Kundalahalli and the centre up by a fifth to a third. Total
7,238,485 (7,238,507 before: rounding). Nothing else in the zones changed: people, income, outlines and the junction
each zone joins are as they were.

**Result:** the centre (MG Road, Shivajinagar, the markets), the Outer Ring Road and Whitefield, Peenya, Manyata,
Electronic City and Bommasandra–Jigani stand out, as they should.

**Known errors.** Large new industrial estates near the airport (the KIADB aerospace and hardware parks) are mapped
as industrial land but are partly empty; counting them by how full they are (above) took most of that out.
Electronic City's 288,000 may still be high: it rests mostly on its tech parks and campuses, counted by area. Places mapped in detail in
OpenStreetMap get more than places mapped thinly; the building-volume half softens this. Informal work is spread by
population, which is a guess.

**Trust.** The pattern (where jobs are dense and where they are not) is right. A single zone's figure may be out by half.

## 4. Income level

**What the player sees:** 1 (poorest) to 5 (richest), a ranking, not a sum of money.

1. **Measure.** The Census 2011 houselisting tables give, for each of the old corporation's 198 wards and for each town
   and village of Bangalore district, the share of households owning a car and the share with a computer and internet.
   A zone's score is the two shares added.
2. **Onto the new wards.** The old 198-ward map (2015 edition on OpenCity) is laid over the new wards on a 90 m grid,
   and each new ward takes the average of the old wards it covers, weighted by where people lived in 2011.
3. **Outer zones** take the average of their villages found in the census table by name. 40 of 42 matched at least one
   village; the other two (in Bengaluru Rural and Ramanagara districts, which the table does not cover) take the middle
   value of the outer zones.
4. **Classes.** Zones are ranked by score and cut into five classes that each hold a fifth of the people.

**Result:** the south (Jayanagar, JP Nagar), Koramangala, Indiranagar, the Whitefield–Bellandur side and the north
(Sadashivanagar, Malleshwaram, Hebbal) come out richest; the old western core and most of the rural ring poorest.

**Trust.** Fair as a ranking of 2011. Fifteen years of change are missing: wards that filled with new apartments since
2011 are probably ranked too low. Car and computer ownership measure wealth only roughly.

**Considered and not used:** ward property-tax collections 2016–19 (OpenCity, no licence given): dominated by
commercial property, so the markets and tech corridors rank "richest"; guidance values (not by ward); Janaagraha's
ward quality scores (2013, services not income).

## 5. The rest of each zone

- `id`: the zone's place in `zones.json`. Wards come first, ordered by corporation and ward number, then outer zones.
- `ward`: for a ward, its corporation and number; absent for outer zones. Added to `src/data/types.ts` as an optional
  field.
- `name`, `nameKn`: wards as notified (every ward has a Kannada name). Outer zones from OpenStreetMap `name` and
  `name:kn`; 15 outer zones have no Kannada name in the map data and carry `null`.
- `centre`: a point well inside the drawn outline, for labels.
- `area`: km², measured on the full outlines before simplification.
- `node`: the junction of A's road network nearest the centre, among junctions inside the drawn outline on a road of
  secondary class or above; else any junction inside; else (15 zones with no main road in them) the nearest junction.
  Must be rebuilt whenever `network.json` changes.

## 6. Credits the game must carry

> Map data © OpenStreetMap contributors (ODbL). Ward boundaries: Greater Bengaluru Authority, via OpenCity.
> Population and building grids: GHSL, European Commission JRC (CC BY 4.0), changed. Census of India 2011.
> All figures are estimates.

- **OpenStreetMap (ODbL):** credit, and share-alike for a derived database made public. `zones.geojson` mixes ODbL
  village lines with the ward map; treat it as ODbL. This is PRD open question 2.
- **GHSL (CC BY 4.0):** credit and "changes indicated"; the line above does both.
- **OpenCity:** asks for credit to OpenCity, and for research and journalism use, an email to opencity@oorvani.in.
- **Census of India:** government statistics, published via OpenCity as public domain.

## 7. Rebuilding

```
brew install gdal osmium-tool
tools/fetch-zones.sh           # about 2 GB of downloads into tools/data (not published)
npx vite-node tools/build-zones.ts
```

The OpenStreetMap extract is Geofabrik's dated file of 27 September 2026 (`southern-zone-260927.osm.pbf`); Geofabrik
keeps dated files only for a while, so a later rebuild will need a newer date and will give slightly different outer
zones and jobs. Everything else is fixed-version.

## 8. Where the roads flood (slice 6)

`src/sim/lowland.ts`, the routing links that lie low, is built by `npx vite-node tools/measure-lowland.ts` (the model's
tool; `--check` compares without writing). It reads, and downloads into `tools/data` where missing:

- **Water:** storm-water drains, streams, rivers and canals (`waterway=`), and lakes and reservoirs (`natural=water`,
  `landuse=reservoir`) from the city's OpenStreetMap extract of slice 1 (`tools/data/city.osm.pbf`), with osmium.
- **Heights:** SRTM, via the AWS Terrain Tiles (Mapzen/Tilezen, `s3.amazonaws.com/elevation-tiles-prod/geotiff`, zoom
  12, 36 tiles), put together over the map at 0.0002° a cell with gdal (`tools/data/dem/`). About 30 m, whole metres; in
  the city it is a surface model (buildings and flyovers show).
- **The city's flood points, to check against:** KSRSAC for the BBMP via OpenCity, "Flooding Locations in Bengaluru
  Urban" (created 15 Feb 2023, updated 27 Nov 2025): 200 flood-vulnerable locations, 70 flood-prone locations and 129
  low-lying areas, as points (`tools/data/bbmp-flood-*.kml`, `bbmp-low-lying.kml`). They are neighbourhoods as much as
  roads.

Credits to carry: SRTM is NASA/USGS, public domain; the Terrain Tiles ask for credit to Mapzen and their sources.
OpenCity as above.
