// Close the welcome window when the button is clicked
document.getElementById("welcome-close").addEventListener("click", () => {
  document.getElementById("welcome-overlay").style.display = "none";
});

//Setting up action dependent state variables that help during map. use.
let hasZoomedForRoute = false;
let directionsControl = null;
let lockedCategory = null;
let navigationActive = false;
let activePOIs = [];

//Map Presets and variable set ups. Includes Centroid calculated from QGIS.
mapboxgl.accessToken =
  "pk.eyJ1IjoibWF4d2VsbGZyZXlyZSIsImEiOiJjbWtjZ2tnanEwMHBpM2ZzOTMwNDg1c2lrIn0.dc7ZFGxZ4-WvoulrtczC8Q";

const MAP_CONTAINER = "map";
const MAP_STYLE = "mapbox://styles/maxwellfreyre/cmli85g0u002k01sk0zsd7fnh";
const INITIAL_CENTER = [-4.2812316, 55.86144386666667];
const INITIAL_ZOOM = 12;

const SUBWAY_LAYER = "final-stations-glasgow-subway";
const POI_LAYER = "final-poi-glasgow-subway";

const hoverPopup = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false,
  className: "station-hover-popup"
});

const poiHoverPopup = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false,
  className: "poi-hover-popup"
});

let selectedStationName = null;

//Here are the appropriate categories for highlighting POIs from Legend hover.
const CATEGORY_COLORS = {
  "Shopping":  "#0078af",
  "Museum":    "#a39c6d",
  "Outdoors":  "#4f9761",
  "Sport":     "#877ab8",
  "Transport": "#346856",
  "Dining":    "#8c2b39",
  "Culture":   "#d5845f",
  "Religion":  "#7a7a7d"
};

//These are the major map functions that put it in place.
function initializeMap() {
  return new mapboxgl.Map({
    container: MAP_CONTAINER,
    style: MAP_STYLE,
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM
  });
}

//Code required for appropriate Geocoding function that specifically allows POIs and their categories to be searched. For example, the code prohibits searching "New York".
function addGeocoder(map) {
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl: mapboxgl,
    marker: false,
    placeholder: "Search Station, POI, or Legend Category",

    localGeocoder: function(query) {
      const q = query.toLowerCase();
      let results = [];

      results = results.concat(
        window.searchableItems
          .filter(item => item.name.toLowerCase().includes(q))
          .map(item => ({
            center: item.coords,
            place_name: item.name,
            place_type: [item.type],
            geometry: {
              type: "Point",
              coordinates: item.coords
            }
          }))
      );

      const categoryMatches = window.searchableItems.filter(item =>
        item.category &&
        item.category.toLowerCase().includes(q)
      );

      categoryMatches.forEach(item => {
        results.push({
          center: item.coords,
          place_name: `${item.category}: ${item.name}`,
          place_type: ["category"],
          geometry: {
            type: "Point",
            coordinates: item.coords
          }
        });
      });

      return results;
    }
  });

  document.getElementById("header-search").appendChild(geocoder.onAdd(map));
}

//This code includes simple zoom bar, scale bar and Location services by calling on Mapbox APIs.
function addControls(map) {
  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  map.addControl(
    new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true
    }),
    "top-right"
  );

  const scale = new mapboxgl.ScaleControl({
    maxWidth: 150,
    unit: "metric"
  });
  map.addControl(scale, "bottom-right");
}

//This code controls the possible interactions that can be made with Subway stations. 
function addStationInteractions(map, directionsControl) {

  // This code aids in subway icon interaction and clicking and hovering.
  const originalRadiusExpression = map.getPaintProperty(SUBWAY_LAYER, "circle-radius");

  map.on("mouseenter", SUBWAY_LAYER, (e) => {
    map.getCanvas().style.cursor = "pointer";

    const hoveredName = e.features[0].properties.DISTNAME;

    //This code is to change the size of the subway icons but during development stopped working. It is possible that further exploration would find that it is being overrid by later code.
    map.setPaintProperty(SUBWAY_LAYER, "circle-radius", [
      "case",
      ["==", ["get", "DISTNAME"], hoveredName],
      14,                 
      originalRadiusExpression 
    ]);

map.setFilter("station-hover-highlight", [
      "==",
      "DISTNAME",
      hoveredName
    ]);

    const coords = e.features[0].geometry.coordinates;

    hoverPopup
      .setLngLat(coords)
      .setHTML(`<strong>${hoveredName}</strong>`)
      .addTo(map);
  });

  map.on("mouseleave", SUBWAY_LAYER, () => {
    map.getCanvas().style.cursor = "";

    //This code was to restore the circle icon size, which does not currently work in this project rendition.
    map.setPaintProperty(SUBWAY_LAYER, "circle-radius", originalRadiusExpression);

    map.setFilter("station-hover-highlight", ["==", "DISTNAME", ""]);
    hoverPopup.remove();
  });

  map.on("click", SUBWAY_LAYER, (e) => {
    selectedStationName = e.features[0].properties.DISTNAME;
    const coords = e.features[0].geometry.coordinates;

    // This code is crucial because it is reseting the navigation in order to 
    directionsControl.removeRoutes();
    navigationActive = false;

    hoverPopup
      .setLngLat(coords)
      .setHTML(`<strong>${selectedStationName}</strong>`)
      .addTo(map);

    map.flyTo({
      center: coords,
      zoom: 15,
      speed: 0.8
    });

    directionsControl.setOrigin(coords);

    map.once("idle", () => {
      if (map.getLayer("directions-origin-label")) {
        map.setLayoutProperty("directions-origin-label", "text-field", "S");
        map.setPaintProperty("directions-origin-label", "text-color", "#ff6200");
        map.setPaintProperty("directions-origin-point", "circle-color", "#ffffff");
        map.setPaintProperty("directions-origin-point", "circle-stroke-color", "#ff6200");
        map.setPaintProperty("directions-origin-point", "circle-radius", 9);
        map.setPaintProperty("directions-origin-point", "circle-stroke-width", 3);
      }
    });

    const poiFeatures = map.queryRenderedFeatures({ layers: [POI_LAYER] });

    activePOIs = poiFeatures.filter(
      f => f.properties.Subway_Station === selectedStationName
    );

    activePOIs.forEach(f => {
      const poiCoords = f.geometry.coordinates;
      const poiName = f.properties.Place_Name;

      new mapboxgl.Popup({ offset: [0, -15], className: "poi-hover-popup" })
        .setLngLat(poiCoords)
        .setHTML(`<h3>${poiName}</h3>`)
        .addTo(map);
    });

    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend(coords);

    activePOIs.forEach(f => {
      bounds.extend(f.geometry.coordinates);
    });

    map.fitBounds(bounds, {
      padding: 90,
      maxZoom: 16,
      duration: 800
    });

  });
}

// This code is for foundational POI interactions such as hover pop-up and clicking in three distinct sections to demostrate different navigation pathways.
function addPOIInteractions(map, directionsControl) {

  map.on("mouseenter", POI_LAYER, (e) => {
    map.getCanvas().style.cursor = "pointer";

    const coords = e.features[0].geometry.coordinates;
    const poiName = e.features[0].properties.Place_Name;

    poiHoverPopup
      .setLngLat(coords)
      .setHTML(`<h3>${poiName}</h3>`)
      .addTo(map);
  });

  map.on("mouseleave", POI_LAYER, () => {
    map.getCanvas().style.cursor = "";
    poiHoverPopup.remove();
  });

map.on("click", POI_LAYER, (e) => {

    const props = e.features[0].properties;
    const poiName = props.Place_Name;
    const poiStation = props.Subway_Station;
    const coords = e.features[0].geometry.coordinates;

    //1.This code is for when Categories from the legend are clicked to show highlights, then clicking on a POI renders navigation.
    if (window.lockedCategory && props.Place_Type === window.lockedCategory) {

        const stationFeature = map
            .queryRenderedFeatures({ layers: [SUBWAY_LAYER] })
            .find(f => f.properties.DISTNAME === poiStation);

        if (!stationFeature) return;

        const stationCoords = stationFeature.geometry.coordinates;

        directionsControl.setOrigin(stationCoords);
        directionsControl.setDestination(coords);
        navigationActive = true;

        new mapboxgl.Popup({
            offset: [0, -15],
            className: "poi-hover-popup"
        })
        .setLngLat(coords)
        .setHTML(`<h3>${poiName}</h3>`)
        .addTo(map);

        return;
    }

    //2. This code manages simple POI clicking to render navigation independent of the legend or station interaction. This makes the map a bit more intuitive and less restrictive in its use.
    if (!selectedStationName) {

        const stationFeature = map
            .queryRenderedFeatures({ layers: [SUBWAY_LAYER] })
            .find(f => f.properties.DISTNAME === poiStation);

        if (!stationFeature) return;

        const stationCoords = stationFeature.geometry.coordinates;

        directionsControl.setOrigin(stationCoords);
        directionsControl.setDestination(coords);
        navigationActive = true;

        new mapboxgl.Popup({
            offset: [0, -15],
            className: "poi-hover-popup"
        })
        .setLngLat(coords)
        .setHTML(`<h3>${poiName}</h3>`)
        .addTo(map);

        return;
    }

    //3. This section manages subway-dependent route initiation.
    if (selectedStationName && poiStation !== selectedStationName) return;

    const isActive = activePOIs.some(
        f => f.properties.Place_Name === poiName
    );
    if (!isActive) return;

    const stationFeature = map
        .queryRenderedFeatures({ layers: [SUBWAY_LAYER] })
        .find(f => f.properties.DISTNAME === selectedStationName);

    if (!stationFeature) return;

    const stationCoords = stationFeature.geometry.coordinates;

    directionsControl.setOrigin(stationCoords);
    directionsControl.setDestination(coords);
    navigationActive = true;

    new mapboxgl.Popup({
        offset: [0, -15],
        className: "poi-hover-popup"
    })
    .setLngLat(coords)
    .setHTML(`<h3>${poiName}</h3>`)
    .addTo(map);
});
}

//This code aids in loading the map and with GEOJSON geometry retrieval.
const map = initializeMap();

map.on("load", () => {
map.resize();
  const stations = map.queryRenderedFeatures({ layers: [SUBWAY_LAYER] });
  const pois = map.queryRenderedFeatures({ layers: [POI_LAYER] });

  window.searchableItems = [
    ...stations.map(f => ({
      name: f.properties.DISTNAME,
      coords: f.geometry.coordinates,
      type: "station"
    })),
    ...pois.map(f => ({
      name: f.properties.Place_Name,
      coords: f.geometry.coordinates,
      type: "poi",
      category: f.properties.Place_Type
    }))
  ];

  directionsControl = new MapboxDirections({
  accessToken: mapboxgl.accessToken,
  unit: "metric",
  profile: "mapbox/walking",
  alternatives: false,
  geometries: "geojson",
  interactive: false,
  controls: {
    inputs: false,
    instructions: true,
    profileSwitcher: false,
    flyTo: false   // ⬅ ADD THIS LINE
  }
});

  map.addControl(directionsControl, "top-left");

  //Here we are managing the legend-dependent circle highlights around the categorized POIs.
  map.addLayer({
    id: "poi-highlight",
    type: "circle",
    source: "composite",
    "source-layer": "FINAL_POI_GLASGOW_SUBWAY",
    paint: {
      "circle-radius": 10,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#ff6200",
      "circle-color": "rgba(0,0,0,0)"
    },
    filter: ["==", "Place_Type", ""]
  }, POI_LAYER);

  //This code controls the characteristic "S" subway logo atop hovered subway stations.
  const subwayLayer = map.getLayer(SUBWAY_LAYER);

  map.addLayer({
    id: "station-hover-highlight",
    type: "circle",
    source: subwayLayer.source,
    "source-layer": subwayLayer["source-layer"],
    paint: {
      "circle-radius": 10,
      "circle-color": "#ff6200",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    },
    filter: ["==", "DISTNAME", ""]
  }, SUBWAY_LAYER);

directionsControl.on("route", (event) => {
  //Below are navigation route styles.
  map.setPaintProperty("directions-route-line", "line-color", "#ffffff");
  map.setPaintProperty("directions-route-line", "line-width", 3);
  map.setPaintProperty("directions-route-line-casing", "line-color", "#000000");
  map.setPaintProperty("directions-route-line-casing", "line-width", 8);
  map.setPaintProperty("directions-origin-point", "circle-color", "#ffffff");
  map.setPaintProperty("directions-origin-point", "circle-stroke-color", "#ff6200");
  map.setPaintProperty("directions-destination-point", "circle-color", "#ff6200");
  map.setPaintProperty("directions-destination-point", "circle-stroke-color", "#ffffff");
  map.setLayoutProperty("directions-origin-label", "text-field", "S");
  map.setPaintProperty("directions-origin-label", "text-color", "#FF6200");
  map.setLayoutProperty("directions-destination-label", "text-field", "End");

  //This code prevents continuous zooming upon pressing a different POI to render new navigation.
  if (hasZoomedForRoute) return;
  hasZoomedForRoute = true;

  //This specifies zooming to the center of the route rather than the POI, which wouldn't be practical to the user.
  const route = event.route[0];
  if (!route || !route.geometry || !route.geometry.coordinates) return;

  const coords = route.geometry.coordinates;
  const midIndex = Math.floor(coords.length / 2);
  const midpoint = coords[midIndex];

  //This code was for the zoom specification on-route but seems to be overriden by later code. A later rendition of the work could fix this.
  map.flyTo({
    center: midpoint,
    zoom: 14,
    speed: 0.7,
    essential: true
  });
});


  map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: [SUBWAY_LAYER, POI_LAYER]
    });

    if (features.length > 0) return;

    directionsControl.removeRoutes();
    selectedStationName = null;
    activePOIs = [];
    navigationActive = false;

    window.lockedCategory = null;
    map.setFilter("poi-highlight", ["==", "Place_Type", ""]);
    map.setPaintProperty("poi-highlight", "circle-stroke-color", "#ff6200");
  });

  addGeocoder(map);
  addControls(map);
  addStationInteractions(map, directionsControl);
  addPOIInteractions(map, directionsControl);

  map.on("idle", () => { buildPOILegend(map); });

});

//This code develops the legend category tabs matching symbolization with accessible tooltips to describe the map's POI icons. It also aids in zooming causing legend categories that are not in the display view to cause legend icons to fade as an extra UX feature.
function buildPOILegend(map) {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";

  const CATEGORY_META = {
    "Shopping":  { color: "#0078af", symbol: "blue basket" },
    "Museum":    { color: "#a39c6d", symbol: "brown diamond" },
    "Outdoors":  { color: "#4f9761", symbol: "green triangle" },
    "Sport":     { color: "#877ab8", symbol: "purple circle" },
    "Transport": { color: "#346856", symbol: "dark green bus" },
    "Dining":    { color: "#8c2b39", symbol: "red cutlery" },
    "Culture":   { color: "#d5845f", symbol: "orange star" },
    "Religion":  { color: "#7a7a7d", symbol: "grey square" }
  };

  const CATEGORY_ORDER = [
    "Shopping",
    "Museum",
    "Outdoors",
    "Sport",
    "Transport",
    "Dining",
    "Culture",
    "Religion"
  ];

  const allFeatures = map.querySourceFeatures("composite", {
    sourceLayer: "FINAL_POI_GLASGOW_SUBWAY"
  });

  const visibleFeatures = map.queryRenderedFeatures({
    layers: [POI_LAYER]
  });

  const visibleCategories = new Set(
    visibleFeatures.map(f => f.properties.Place_Type)
  );

  const tabsContainer = document.createElement("div");
  tabsContainer.className = "legend-tabs";

  CATEGORY_ORDER.forEach(type => {
    const meta = CATEGORY_META[type];

    const tab = document.createElement("div");
    tab.className = "legend-tab";
    tab.style.backgroundColor = meta.color;
    tab.innerHTML = `${type}`;

    const tooltip = document.createElement("div");
    tooltip.className = "legend-tab-tooltip";
    tooltip.innerText = `${meta.symbol}`;
    tab.appendChild(tooltip);

    if (!visibleCategories.has(type)) {
      tab.classList.add("faded");
    }

    //Code to affirm highlighting POIs from Legend hover.
    tab.addEventListener("mouseenter", () => {
      if (window.lockedCategory) return;
      map.setFilter("poi-highlight", ["==", "Place_Type", type]);
      map.setPaintProperty("poi-highlight", "circle-stroke-color", CATEGORY_COLORS[type]);
    });

    // Highlighting here is omitted upon leaving the hover state.
    tab.addEventListener("mouseleave", () => {
      if (window.lockedCategory) return;
      map.setFilter("poi-highlight", ["==", "Place_Type", ""]);
      map.setPaintProperty("poi-highlight", "circle-stroke-color", "#ff6200");
    });

    // Here clicking locks the highlights in order to be able to render Legend-dependent nav.
    tab.addEventListener("click", () => {
      if (window.lockedCategory === type) {
        window.lockedCategory = null;
        map.setFilter("poi-highlight", ["==", "Place_Type", ""]);
        map.setPaintProperty("poi-highlight", "circle-stroke-color", "#ff6200");

        document.querySelectorAll(".legend-tab").forEach(t =>
          t.classList.remove("active")
        );

        return;
      }

      window.lockedCategory = type;
      map.setFilter("poi-highlight", ["==", "Place_Type", type]);
      map.setPaintProperty("poi-highlight", "circle-stroke-color", CATEGORY_COLORS[type]);

      document.querySelectorAll(".legend-tab").forEach(t =>
        t.classList.remove("active")
      );
      tab.classList.add("active");
    });

    tabsContainer.appendChild(tab);
  });

  legend.appendChild(tabsContainer);
}
//This code locates initial Welcome overlay functions at the start of web map browsing.
const welcomeOverlay = document.getElementById("welcome-overlay");
const welcomeClose = document.getElementById("welcome-close");
const helpTab = document.getElementById("help-tab");

//Clicking Start Exploring allows the Help button to appear and be the site where the Welcome Window's info is contained.
welcomeClose.addEventListener("click", () => {
  welcomeOverlay.style.display = "none";
  helpTab.style.display = "block";
});

// Here help shows the Welcome Window again at the user's discretion.
helpTab.addEventListener("click", () => {
  welcomeOverlay.style.display = "flex";  
  helpTab.style.display = "none";         
});