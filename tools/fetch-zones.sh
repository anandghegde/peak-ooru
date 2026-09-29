#!/bin/bash
# Downloads what the zones are built from into tools/data: the ward map, census tables, the population grid,
# and the OpenStreetMap layers that jobs and the outer zones are estimated from. See docs/DATA.md.
# Needs curl, unzip, GDAL and osmium (brew install gdal osmium-tool).
# Usage: tools/fetch-zones.sh [part ...]   (every part if none is named: wards ghsl osm)
set -uo pipefail
dir="$(dirname "$0")/data"; mkdir -p "$dir"
parts=("${@:-wards ghsl osm}")
want() { [[ " ${parts[*]} " == *" $1 "* ]]; }
get() { # <file> <url>
  curl -sSL --fail --max-time 900 -o "$dir/$1" "$2" && echo "  $1: ok" || { echo "  $1: FAILED"; exit 1; }
}

if want wards; then
  # From OpenCity (data.opencity.in). The Greater Bengaluru Authority's 369 wards as notified on 19 November 2025,
  # with the renamings of 1 December 2025 and the 2011 census population of each ward.
  gba=https://data.opencity.in/dataset/863209cb-4ced-4f51-b5c5-156939c50922/resource
  get gba-369-wards-2025-12.kml "$gba/9013d656-8051-4e2d-9648-46efd0d86d3d/download/gba-369-wards-december-2025.kml"
  # The old corporation's 198 wards, which the 2011 census tables are counted by.
  bbmp=https://data.opencity.in/dataset/87b978d1-352e-4b90-aa2c-9991e55d3425/resource
  get bbmp-198-wards-2015.kml "$bbmp/a0329df6-2924-43f4-8fe4-7a6ffcc1d53d/download/806d6b9c-e8d9-4eb0-a3a3-b2ba68ec3cda.kml"
  # Census 2011 household assets by ward, town and village, for income.
  census=https://data.opencity.in/dataset/023a1c0c-1901-4eb1-b1bf-66a900485099/resource
  get census2011-assets.csv "$census/4efdf9f5-5790-41ca-ac68-13691b31f364/download/a7c8acc4-6540-4152-9fee-aa084baac188.csv"
fi

if want ghsl; then
  # GHSL grids (European Commission JRC, R2023A) at 3 arcseconds (about 90 m), cut to the game's area and written as
  # plain text grids that the builder reads without GDAL: population for 2010, 2015, 2025 and 2030, and the volume of
  # all buildings and of buildings other than homes for 2010 and 2020.
  ghsl=https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL
  grid() { # <product> <epoch> <file stem>
    local name=GHS_$1_E$2_GLOBE_R2023A_4326_3ss_V1_0
    local zip="$dir/${name}_R8_C26.zip"
    [ -s "$zip" ] || curl -sS --fail --max-time 900 -o "$zip" \
      "$ghsl/GHS_${1%%_NRES}_GLOBE_R2023A/GHS_$1_E$2_GLOBE_R2023A_4326_3ss/V1-0/tiles/${name}_R8_C26.zip" || exit 1
    unzip -o -q "$zip" "*.tif" -d "$dir/ghsl"
    gdal_translate -q -of AAIGrid -projwin 77.35 13.20 77.85 12.75 "$dir/ghsl/${name}_R8_C26.tif" "$dir/zones.$3.asc" \
      && echo "  $3: ok"
  }
  for epoch in 2010 2015 2025 2030; do grid POP $epoch pop$epoch; done
  for epoch in 2010 2020; do grid BUILT_V $epoch built$epoch; grid BUILT_V_NRES $epoch built_NRES$epoch; done
fi

if want osm; then
  # A dated Geofabrik extract rather than Overpass, which times out on layers this size for the whole city.
  pbf=southern-zone-260927.osm.pbf
  [ -s "$dir/zones.$pbf" ] || get "zones.$pbf" "https://download.geofabrik.de/asia/india/$pbf"
  osmium extract --overwrite -s smart -b 77.35,12.75,77.85,13.20 "$dir/zones.$pbf" -o "$dir/zones.city.osm.pbf" || exit 1
  layer() { # <name> <filter ...>
    local name=$1; shift
    osmium tags-filter --overwrite "$dir/zones.city.osm.pbf" "$@" -o "$dir/zones.$name.osm.pbf" \
      && osmium export --overwrite -f geojsonseq -a type,id "$dir/zones.$name.osm.pbf" -o "$dir/zones.$name.geojsonseq" \
      && echo "  $name: $(wc -l < "$dir/zones.$name.geojsonseq" | tr -d ' ') features"
  }
  # Village boundaries, for the coarse zones outside the wards.
  layer villages r/boundary=administrative
  layer places n/place=city,town,suburb,village
  # Land and places where people work.
  layer land wr/landuse=commercial,retail,industrial
  layer work nwr/office nwr/shop \
    nwr/amenity=hospital,clinic,doctors,school,college,university,marketplace,bank,restaurant,cafe,fast_food,cinema,townhall,courthouse,police,fire_station,post_office \
    nwr/tourism=hotel
fi
echo "saved in $dir"
