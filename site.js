/**
 * Directory and map behavior for Eating on 30A.
 * Filter rules live in matches() so the homepage query strings and the
 * directory stay in lockstep. Imported by tests; the browser boots below.
 */

const FILTER_KEYS = ["meal", "area", "cuisine", "q", "outdoor", "kids", "music"];

export function filtersFromParams(params) {
  const read = (key) => (params.get(key) || "").trim();
  return {
    meal: read("meal"),
    area: read("area"),
    cuisine: read("cuisine"),
    q: read("q"),
    outdoor: read("outdoor"),
    kids: read("kids"),
    music: read("music"),
  };
}

export function matches(record, filters) {
  if (filters.area && record.areaSlug !== filters.area) return false;
  if (filters.meal) {
    const want = filters.meal.toLowerCase();
    const meals = (record.meals || []).map((meal) => meal.toLowerCase());
    if (!meals.includes(want)) return false;
  }
  if (filters.cuisine) {
    const want = filters.cuisine.toLowerCase();
    const cuisines = (record.cuisines || []).map((cuisine) => cuisine.toLowerCase());
    if (!cuisines.includes(want)) return false;
  }
  if (filters.outdoor === "yes" && !record.outdoor) return false;
  if (filters.kids === "yes" && !record.kids) return false;
  if (filters.music === "yes" && !record.music) return false;
  const query = (filters.q || "").trim().toLowerCase();
  if (query && !(record.search || "").toLowerCase().includes(query)) return false;
  return true;
}

export function spreadOverlaps(items) {
  const groups = new Map();
  for (const item of items) {
    if (typeof item.lat !== "number" || typeof item.lng !== "number") continue;
    const key = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const placed = [];
  for (const group of groups.values()) {
    group.forEach((item, index) => {
      if (group.length === 1) {
        placed.push({ ...item, pinLat: item.lat, pinLng: item.lng });
        return;
      }
      const angle = (2 * Math.PI * index) / group.length;
      const radius = 0.00018;
      placed.push({
        ...item,
        pinLat: item.lat + radius * Math.cos(angle),
        pinLng: item.lng + radius * Math.sin(angle),
      });
    });
  }
  return placed;
}

export function markerPopup(item) {
  const href = `/restaurants/${encodeURIComponent(item.slug)}/`;
  const photo = item.image
    ? `<img class="popup-photo" src="${escapeHtml(item.image)}" alt="">`
    : "";
  const area = item.area ? `<p class="popup-kicker">${escapeHtml(item.area)}</p>` : "";
  const address = item.address ? `<p class="popup-address">${escapeHtml(item.address)}</p>` : "";
  return (
    `<div class="map-popup">${photo}${area}` +
    `<strong>${escapeHtml(item.name || "")}</strong>` +
    `${address}<p><a href="${href}">View profile</a></p></div>`
  );
}

export function describeFilters(filters, areaNames, emptyLabel = "The table") {
  const parts = [];
  if (filters.meal) parts.push(filters.meal);
  if (filters.cuisine) parts.push(filters.cuisine);
  if (filters.q) parts.push(`“${filters.q}”`);
  if (filters.outdoor === "yes") parts.push("Outdoor dining");
  if (filters.kids === "yes") parts.push("Kid friendly");
  if (filters.music === "yes") parts.push("Live music");
  let label = parts.length ? parts.join(" · ") : emptyLabel;
  if (filters.area) {
    const town = areaNames[filters.area] || filters.area;
    label += ` in ${town}`;
  }
  return label;
}

function recordFromCard(card) {
  const split = (value) => (value ? value.split("|").filter(Boolean) : []);
  return {
    areaSlug: card.dataset.area || "",
    meals: split(card.dataset.meals),
    cuisines: split(card.dataset.cuisines),
    outdoor: card.dataset.outdoor === "yes",
    kids: card.dataset.kids === "yes",
    music: card.dataset.music === "yes",
    search: card.dataset.search || "",
  };
}

function readAreaNames() {
  const node = document.querySelector("#area-names");
  if (!node) return {};
  try {
    return JSON.parse(node.textContent || "{}");
  } catch {
    return {};
  }
}

function formFilters(form) {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = (data.get(key) || "").toString().trim();
    if (value) params.set(key, value);
  }
  return filtersFromParams(params);
}

function writeForm(form, filters) {
  for (const key of FILTER_KEYS) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === "checkbox") field.checked = filters[key] === "yes";
    else field.value = filters[key] || "";
  }
}

function paramsFromFilters(filters) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return params;
}

function syncUrl(filters) {
  const params = paramsFromFilters(filters);
  const query = params.toString();
  const next = query ? `${location.pathname}?${query}` : location.pathname;
  history.replaceState(null, "", next);
}

function bootDirectory() {
  const form = document.querySelector("#filters");
  const cards = [...document.querySelectorAll("#cards .card")];
  const count = document.querySelector("#result-count");
  const title = document.querySelector("#listing-title");
  const empty = document.querySelector("#empty");
  const areaNames = readAreaNames();

  const apply = (filters, pushUrl) => {
    let shown = 0;
    for (const card of cards) {
      const visible = matches(recordFromCard(card), filters);
      card.classList.toggle("is-hidden", !visible);
      if (visible) shown += 1;
    }
    const label = describeFilters(filters, areaNames);
    if (title) title.textContent = label;
    if (count) {
      count.textContent = shown === 1 ? "1 restaurant" : `${shown} restaurants`;
    }
    if (empty) empty.hidden = shown !== 0;
    document.title = `${label} | Eating on 30A`;
    if (pushUrl) syncUrl(filters);
    document.documentElement.classList.remove("js-filter");
  };

  const current = filtersFromParams(new URLSearchParams(location.search));
  writeForm(form, current);
  apply(current, false);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply(formFilters(form), true);
  });
  form.addEventListener("input", () => apply(formFilters(form), true));
  form.addEventListener("change", () => apply(formFilters(form), true));
  window.addEventListener("popstate", () => {
    const filters = filtersFromParams(new URLSearchParams(location.search));
    writeForm(form, filters);
    apply(filters, false);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

function bootMap() {
  const mapNode = document.querySelector("#map");
  const form = document.querySelector("#filters");
  const list = document.querySelector("#map-list");
  const count = document.querySelector("#result-count");
  const title = document.querySelector("#listing-title");
  const note = document.querySelector("#map-note");
  const areaNames = readAreaNames();
  if (typeof L === "undefined") {
    if (note) note.textContent = "The map library did not load.";
    return;
  }

  const map = L.map(mapNode, { scrollWheelZoom: true }).setView([30.32, -86.12], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const icon = L.divIcon({
    className: "pin",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });

  let markers = [];
  let restaurants = [];

  const draw = (filters) => {
    markers.forEach((marker) => marker.remove());
    markers = [];
    if (list) list.replaceChildren();
    const visible = spreadOverlaps(restaurants.filter((item) => matches(item, filters)));
    const bounds = [];
    for (const item of visible) {
      const marker = L.marker([item.pinLat, item.pinLng], { icon }).addTo(map);
      const href = `/restaurants/${encodeURIComponent(item.slug)}/`;
      marker.bindPopup(markerPopup(item), { maxWidth: 280 });
      markers.push(marker);
      bounds.push([item.pinLat, item.pinLng]);
      if (list) {
        const link = document.createElement("a");
        link.href = href;
        link.className = "map-hit";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const meta = document.createElement("span");
        meta.textContent = [item.area, item.price].filter(Boolean).join(" · ");
        link.append(name, meta);
        if (item.address) {
          const address = document.createElement("span");
          address.className = "map-address";
          address.textContent = item.address;
          link.append(address);
        }
        link.addEventListener("mouseenter", () => marker.openPopup());
        list.append(link);
      }
    }
    const label = describeFilters(filters, areaNames, "Along the coast");
    if (title) title.textContent = label;
    if (count) count.textContent = visible.length === 1 ? "1 place on the map" : `${visible.length} places on the map`;
    if (note) {
      note.hidden = visible.length !== 0;
      note.textContent = visible.length === 0 ? "No restaurants match these filters." : "";
    }
    document.title = `${label} map | Eating on 30A`;
    if (bounds.length === 1) map.setView(bounds[0], 15);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
    else map.setView([30.32, -86.12], 11);
  };

  const apply = (filters, pushUrl) => {
    draw(filters);
    if (pushUrl) syncUrl(filters);
  };

  fetch("/data/restaurants.json")
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then((data) => {
      restaurants = data;
      const filters = filtersFromParams(new URLSearchParams(location.search));
      if (form) writeForm(form, filters);
      apply(filters, false);
      if (!form) return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        apply(formFilters(form), true);
      });
      form.addEventListener("input", () => apply(formFilters(form), true));
      form.addEventListener("change", () => apply(formFilters(form), true));
    })
    .catch(() => {
      if (note) {
        note.hidden = false;
        note.textContent = "The restaurant list could not be loaded.";
      }
    });
}

function bootDetailMap() {
  const node = document.querySelector("#detail-map");
  if (!node || typeof L === "undefined") return;
  const lat = Number(node.dataset.lat);
  const lng = Number(node.dataset.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const map = L.map(node, { scrollWheelZoom: false }).setView([lat, lng], 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const icon = L.divIcon({
    className: "pin",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  L.marker([lat, lng], { icon }).addTo(map).bindPopup(markerPopup({
    slug: node.dataset.slug || "",
    name: node.dataset.name || "Restaurant",
    area: node.dataset.area || "",
    address: node.dataset.address || "",
    image: node.dataset.image || "",
  }), { maxWidth: 280 });
}

function boot() {
  if (document.querySelector("#cards") && document.querySelector("#filters")) bootDirectory();
  if (document.querySelector("#map")) bootMap();
  if (document.querySelector("#detail-map")) bootDetailMap();
}

if (typeof document !== "undefined") boot();
