/**
 * Directory and map behavior for Eating on 30A.
 * Filter rules live in matches() so the homepage query strings and the
 * directory stay in lockstep. Imported by tests; the browser boots below.
 */

const FILTER_KEYS = ["meal", "area", "cuisine", "q", "outdoor", "kids", "music", "reservations", "groups", "happyfood", "happydrinks", "laurensFavorite"];

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
    reservations: read("reservations"),
    groups: read("groups"),
    happyfood: read("happyfood"),
    happydrinks: read("happydrinks"),
    laurensFavorite: read("laurensFavorite"),
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
  if (filters.reservations === "yes" && !record.reservations) return false;
  if (filters.groups === "yes" && !record.groups) return false;
  if (filters.happyfood === "yes" && !record.happyFood) return false;
  if (filters.happydrinks === "yes" && !record.happyDrinks) return false;
  if (filters.laurensFavorite === "yes" && !record.laurensFavorite) return false;
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

const MONOGRAM_SKIP = new Set(["the", "and", "at", "of", "a", "an", "by", "for", "on", "in"]);

export function monogram(name) {
  const cleaned = String(name || "").replace(/[’']/g, "").replace(/&/g, " ");
  let words = (cleaned.match(/[A-Za-z0-9]+/g) || []).filter((word) => !MONOGRAM_SKIP.has(word.toLowerCase()));
  if (!words.length) words = String(name || "").match(/[A-Za-z0-9]+/g) || ["E"];
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

function listTone(item) {
  const blob = [...(item.cuisines || []), ...(item.foods || [])].join(" ").toLowerCase();
  if (/coffee|cafe|donut/.test(blob)) return "coffee";
  if (/dessert|ice cream|chocolate|sweet/.test(blob)) return "sweet";
  if (/pizza|italian/.test(blob)) return "italian";
  if (/sushi|japanese/.test(blob)) return "sushi";
  if (/seafood|oyster|fish/.test(blob)) return "seafood";
  if (/burger/.test(blob)) return "burger";
  if (/mexican|taco|latin/.test(blob)) return "spice";
  if (/wine|bar/.test(blob)) return "wine";
  return "gulf";
}

export function mapListCard(item) {
  const href = `/restaurants/${encodeURIComponent(item.slug || "")}/`;
  const name = item.name || "";
  const area = item.label || item.area || "";
  const meta = [item.area, item.price].filter(Boolean).join(" · ");
  const media = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(name || "Restaurant")}">`
    : `<span class="map-thumb ph" data-tone="${escapeHtml(listTone(item))}"><span class="mono" aria-hidden="true">${escapeHtml(monogram(name))}</span></span>`;
  const thumb = item.image ? `<span class="map-thumb">${media}</span>` : media;
  const address = item.address ? `<span class="map-address">${escapeHtml(item.address)}</span>` : "";
  return (
    `<article class="map-hit">` +
    `<a class="map-hit-link" href="${href}">${thumb}<span class="map-copy">` +
    `<strong>${escapeHtml(name)}</strong>` +
    `<span class="map-meta">${escapeHtml(meta)}</span>${address}</span></a>` +
    `<div class="save-slot" data-slug="${escapeHtml(item.slug || "")}" data-name="${escapeHtml(name)}" data-area="${escapeHtml(area)}"></div>` +
    `</article>`
  );
}

export function markerPopup(item) {
  const href = `/restaurants/${encodeURIComponent(item.slug)}/`;
  const photo = item.image
    ? `<img class="popup-photo" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name || "Restaurant")}">`
    : "";
  const area = item.area ? `<p class="popup-kicker">${escapeHtml(item.area)}</p>` : "";
  const address = item.address ? `<p class="popup-address">${escapeHtml(item.address)}</p>` : "";
  return (
    `<div class="map-popup">${photo}${area}` +
    `<strong>${escapeHtml(item.name || "")}</strong>` +
    `${address}<p><a href="${href}">View restaurant</a></p></div>`
  );
}

export function featuredIndex(count, now = Date.now()) {
  const total = Number(count) || 0;
  if (total <= 1) return 0;
  const day = Math.floor(Number(now) / 86400000);
  return ((day % total) + total) % total;
}

export function stepFeatured(index, delta, count) {
  const total = Number(count) || 0;
  if (total <= 0) return 0;
  const current = Math.trunc(Number(index) || 0);
  const move = Math.trunc(Number(delta) || 0);
  return ((current + move) % total + total) % total;
}

export const FEATURED_ROTATE_MS = 8000;

export function featuredAutoRotate(count, prefersReducedMotion = false, paused = false) {
  if (prefersReducedMotion || paused) return false;
  return (Number(count) || 0) > 1;
}

export function filtersAreActive(filters) {
  return FILTER_KEYS.some((key) => filters && filters[key]);
}

export function documentTitle(baseTitle, filters, activeTitle) {
  return filtersAreActive(filters) ? activeTitle : baseTitle;
}

export function describeFilters(filters, areaNames, emptyLabel = "Restaurants on 30A") {
  const parts = [];
  if (filters.meal) parts.push(filters.meal);
  if (filters.cuisine) parts.push(filters.cuisine);
  if (filters.q) parts.push(`“${filters.q}”`);
  if (filters.outdoor === "yes") parts.push("Outdoor dining");
  if (filters.kids === "yes") parts.push("Kid friendly");
  if (filters.music === "yes") parts.push("Live music");
  if (filters.reservations === "yes") parts.push("Takes reservations");
  if (filters.groups === "yes") parts.push("Good for groups 12+");
  if (filters.happyfood === "yes") parts.push("Happy hour food");
  if (filters.happydrinks === "yes") parts.push("Happy hour drinks");
  if (filters.laurensFavorite === "yes") parts.push("Lauren’s Favorites");
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
    reservations: card.dataset.reservations === "yes",
    groups: card.dataset.groups === "yes",
    happyFood: card.dataset.happyfood === "yes",
    happyDrinks: card.dataset.happydrinks === "yes",
    laurensFavorite: card.dataset.laurensFavorite === "yes",
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

export function viewHref(path, filters) {
  const query = paramsFromFilters(filters).toString();
  return query ? `${path}?${query}` : path;
}

function syncViewLinks(filters) {
  document.querySelectorAll("[data-view-href]").forEach((link) => {
    const path = link.getAttribute("data-view-href");
    if (path) link.href = viewHref(path, filters);
  });
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
  const baseTitle = document.title;

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
    document.title = documentTitle(baseTitle, filters, `${label} | Eating on 30A`);
    syncViewLinks(filters);
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

function restaurantPin() {
  // Leaflet writes className onto .leaflet-marker-icon and drops the default
  // leaflet-div-icon class, so the visible dot is .leaflet-marker-icon.pin.
  return L.divIcon({
    className: "pin",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
}

function bootMap() {
  const mapNode = document.querySelector("#map");
  const form = document.querySelector("#filters");
  const list = document.querySelector("#map-list");
  const count = document.querySelector("#result-count");
  const title = document.querySelector("#listing-title");
  const note = document.querySelector("#map-note");
  const areaNames = readAreaNames();
  const baseTitle = document.title;
  if (typeof L === "undefined") {
    if (note) note.textContent = "The map library did not load.";
    return;
  }

  const map = L.map(mapNode, { scrollWheelZoom: true }).setView([30.32, -86.12], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const icon = restaurantPin();

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
      marker.bindPopup(markerPopup(item), { maxWidth: 280 });
      markers.push(marker);
      bounds.push([item.pinLat, item.pinLng]);
      if (list) {
        const holder = document.createElement("div");
        holder.innerHTML = mapListCard(item);
        const card = holder.firstElementChild;
        const link = card.querySelector("a") || card;
        const open = () => marker.openPopup();
        link.addEventListener("mouseenter", open);
        link.addEventListener("focus", open);
        list.append(card);
      }
    }
    document.dispatchEvent(new CustomEvent("cards-mounted"));
    const label = describeFilters(filters, areaNames, "Along the coast");
    if (title) title.textContent = label;
    if (count) count.textContent = visible.length === 1 ? "1 restaurant on the map" : `${visible.length} restaurants on the map`;
    if (note) {
      note.hidden = visible.length !== 0;
      note.textContent = visible.length === 0 ? "No restaurants match these filters." : "";
    }
    document.title = documentTitle(baseTitle, filters, `${label} map | Eating on 30A`);
    if (bounds.length === 1) map.setView(bounds[0], 15);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
    else map.setView([30.32, -86.12], 11);
  };

  const apply = (filters, pushUrl) => {
    draw(filters);
    syncViewLinks(filters);
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
  const icon = restaurantPin();
  L.marker([lat, lng], { icon }).addTo(map).bindPopup(markerPopup({
    slug: node.dataset.slug || "",
    name: node.dataset.name || "Restaurant",
    area: node.dataset.area || "",
    address: node.dataset.address || "",
    image: node.dataset.image || "",
  }), { maxWidth: 280 });
}

function bootFeatured() {
  const root = document.querySelector("#from-the-guide");
  if (!root || root.dataset.featuredBound === "true") return;
  const slots = [...root.querySelectorAll("[data-featured]")];
  if (slots.length < 2) return;
  root.dataset.featuredBound = "true";
  let index = slots.findIndex((slot) => !slot.hidden);
  if (index < 0) index = featuredIndex(slots.length);
  const status = root.querySelector("[data-featured-status]");
  const controls = root.querySelector(".cover-controls");
  if (controls) controls.hidden = false;

  const show = (next, announce) => {
    index = stepFeatured(next, 0, slots.length);
    slots.forEach((slot, position) => {
      slot.hidden = position !== index;
    });
    if (!announce || !status) return;
    const heading = slots[index].querySelector("h2");
    const name = heading ? heading.textContent.trim() : "";
    status.textContent = name ? `${name}, ${index + 1} of ${slots.length}` : "";
  };

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motion.matches;
  let pointerInside = false;
  let focusInside = root.contains(document.activeElement);
  let timer = 0;

  const clearTimer = () => {
    if (!timer) return;
    window.clearInterval(timer);
    timer = 0;
  };

  const syncTimer = () => {
    clearTimer();
    const paused = pointerInside || focusInside || document.hidden;
    if (!featuredAutoRotate(slots.length, reducedMotion, paused)) return;
    timer = window.setInterval(() => {
      show(stepFeatured(index, 1, slots.length), false);
    }, FEATURED_ROTATE_MS);
  };

  const stepBy = (delta) => {
    show(stepFeatured(index, delta, slots.length), true);
    syncTimer();
  };

  show(index, false);

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-featured-step]");
    if (!button || !root.contains(button)) return;
    stepBy(Number(button.getAttribute("data-featured-step")));
  });

  root.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".cover-arrow")) return;
    event.preventDefault();
    stepBy(event.key === "ArrowLeft" ? -1 : 1);
  });

  root.addEventListener("mouseenter", () => {
    pointerInside = true;
    syncTimer();
  });
  root.addEventListener("mouseleave", () => {
    pointerInside = false;
    syncTimer();
  });
  root.addEventListener("focusin", () => {
    focusInside = true;
    syncTimer();
  });
  root.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && root.contains(next)) return;
    focusInside = false;
    syncTimer();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimer();
    else syncTimer();
  });
  window.addEventListener("pagehide", clearTimer);
  motion.addEventListener("change", () => {
    reducedMotion = motion.matches;
    syncTimer();
  });

  syncTimer();
}

function boot() {
  bootFeatured();
  if (document.querySelector("#cards") && document.querySelector("#filters")) bootDirectory();
  if (document.querySelector("#map")) bootMap();
  if (document.querySelector("#detail-map")) bootDetailMap();
}

if (typeof document !== "undefined") boot();
