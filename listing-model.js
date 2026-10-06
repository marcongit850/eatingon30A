/**
 * Editable restaurant fields shared by the accounts Worker and both guides.
 * SEO is not a field. Titles, descriptions, and social tags stay generated.
 * Status defaults to live. Draft is the only hidden state.
 */

export const DEFAULT_ADMINS = ["marc@whpinc.com"];
export const SITES = new Set(["30a", "destin"]);
export const MAX_PHOTOS = 24;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const SEO_KEYS = ["seo", "metaTitle", "metaDescription", "ogTitle", "ogDescription", "ogImage", "canonical", "jsonLd", "schema"];
const PRICES = new Set(["", "$", "$$", "$$$", "$$$$"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_SRC = /^\/images\/restaurants\/[a-z0-9][a-z0-9./_-]*\.(jpe?g|png|webp)$/i;
const MEDIA_SRC = /^\/media\/photos\/([a-f0-9-]{36})$/;

export function adminEmails(env) {
  const configured = env && env.ADMIN_EMAILS;
  const source = configured ? String(configured).split(",") : DEFAULT_ADMINS;
  return new Set(source.map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export function isAdminEmail(email, env) {
  return adminEmails(env).has(String(email || "").trim().toLowerCase());
}

export function slugify(value) {
  const text = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "restaurant";
}

export function uniqueSlug(base, used) {
  const root = base || "restaurant";
  if (!used.has(root)) return root;
  let number = 2;
  while (used.has(`${root}-${number}`)) number += 1;
  return `${root}-${number}`;
}

export function listingSlug(name, area, used) {
  return uniqueSlug(slugify(`${name} ${area}`), used);
}

export function isSlug(value) {
  const text = String(value || "");
  return SLUG.test(text) && text.length <= 140;
}

export function normalizeStatus(value) {
  if (value == null || value === "") return { status: "live" };
  const text = String(value).trim().toLowerCase();
  if (text === "live" || text === "published") return { status: "live" };
  if (text === "draft") return { status: "draft" };
  return { error: "Choose Live or Draft." };
}

function cleanLine(value, max) {
  const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > max) return { error: true };
  return { text };
}

function cleanBlock(value, max) {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (text.length > max) return { error: true };
  return { text };
}

function stringList(value, maxItems, itemMax, label) {
  let items = value;
  if (value == null || value === "") items = [];
  else if (typeof value === "string") items = value.split(",");
  if (!Array.isArray(items)) return { error: `Enter ${label} as a list.` };
  const out = [];
  for (const item of items) {
    const cleaned = cleanLine(item, itemMax);
    if (cleaned.error) return { error: `Keep each ${label} entry under ${itemMax} characters.` };
    if (cleaned.text && !out.includes(cleaned.text)) out.push(cleaned.text);
  }
  if (out.length > maxItems) return { error: `Keep ${label} to ${maxItems} entries.` };
  return { value: out };
}

function flag(value, label) {
  if (value === true || value === "yes" || value === "true" || value === "on") return { value: true };
  if (value == null || value === false || value === "" || value === "no" || value === "false") return { value: false };
  return { error: `Choose yes or no for ${label}.` };
}

function coord(value, min, max, label) {
  if (value == null || value === "") return { value: null };
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || number < min || number > max) return { error: `Enter a valid ${label}.` };
  return { value: number };
}

function optionalUrl(value, label) {
  const cleaned = cleanLine(value, 300);
  if (cleaned.error) return { error: `Keep the ${label} link under 300 characters.` };
  if (!cleaned.text) return { text: "" };
  if (!/^https?:\/\//i.test(cleaned.text) || /\s/.test(cleaned.text)) {
    return { error: `Start the ${label} link with http:// or https://` };
  }
  try {
    const url = new URL(cleaned.text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: `Start the ${label} link with http:// or https://` };
  } catch {
    return { error: `That ${label} link is not valid.` };
  }
  return { text: cleaned.text };
}

export function photoIdFromSrc(src) {
  const match = String(src || "").match(MEDIA_SRC);
  return match ? match[1] : "";
}

export function validatePhotos(value, allowedIds) {
  if (value == null || value === "") return { value: [] };
  if (!Array.isArray(value)) return { error: "Photos could not be saved." };
  if (value.length > MAX_PHOTOS) return { error: `Keep it to ${MAX_PHOTOS} photos.` };
  const photos = [];
  const seen = new Set();
  for (const item of value) {
    const src = typeof item === "string" ? item : item && item.src;
    const text = String(src || "");
    if (text.includes("..") || text.includes("\\")) return { error: "That photo could not be saved." };
    if (/^https:\/\/[^\s]+$/i.test(text) && text.length <= 300) {
      if (seen.has(text)) continue;
      seen.add(text);
      photos.push({ id: null, src: text });
      continue;
    }
    const mediaId = photoIdFromSrc(text);
    if (mediaId) {
      const id = typeof item === "object" && item && item.id ? String(item.id) : mediaId;
      if (id !== mediaId) return { error: "That photo could not be saved." };
      if (allowedIds && !allowedIds.has(id)) return { error: "That photo could not be saved." };
      if (seen.has(id)) continue;
      seen.add(id);
      photos.push({ id, src: `/media/photos/${id}` });
      continue;
    }
    if (!IMAGE_SRC.test(text)) return { error: "That photo could not be saved." };
    if (seen.has(text)) continue;
    seen.add(text);
    photos.push({ id: null, src: text });
  }
  return { value: photos };
}

export function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return "";
}

export function validateListing(input, { allowedPhotoIds } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Send the listing as JSON." };
  for (const key of SEO_KEYS) {
    if (Object.hasOwn(input, key)) return { error: "SEO fields are not editable." };
  }
  const name = cleanLine(input.name, 160);
  if (name.error || !name.text) return { error: name.error ? "Keep the restaurant name under 160 characters." : "Enter the restaurant name." };
  const area = cleanLine(input.area, 120);
  if (area.error || !area.text) return { error: area.error ? "Keep the area under 120 characters." : "Choose an area of town." };
  const subarea = cleanLine(input.subarea, 120);
  if (subarea.error) return { error: "Keep the subarea under 120 characters." };
  const label = cleanLine(input.label, 160);
  if (label.error) return { error: "Keep the location label under 160 characters." };
  const address = cleanLine(input.address, 240);
  if (address.error) return { error: "Keep the address under 240 characters." };
  const lat = coord(input.lat, -90, 90, "latitude");
  if (lat.error) return { error: lat.error };
  const lng = coord(input.lng, -180, 180, "longitude");
  if (lng.error) return { error: lng.error };
  const phone = cleanLine(input.phone, 40);
  if (phone.error) return { error: "Keep the phone number under 40 characters." };
  const website = optionalUrl(input.website, "website");
  if (website.error) return { error: website.error };
  const facebook = optionalUrl(input.facebook, "Facebook");
  if (facebook.error) return { error: facebook.error };
  const instagram = optionalUrl(input.instagram, "Instagram");
  if (instagram.error) return { error: instagram.error };
  const price = input.price == null ? "" : String(input.price).trim();
  if (!PRICES.has(price)) return { error: "Choose a price." };
  const notes = cleanBlock(input.notes, 4000);
  if (notes.error) return { error: "Keep the description under 4,000 characters." };
  const hours = cleanBlock(input.hours, 1000);
  if (hours.error) return { error: "Keep the hours under 1,000 characters." };
  const cuisines = stringList(input.cuisines, 12, 40, "cuisine");
  if (cuisines.error) return { error: cuisines.error };
  const meals = stringList(input.meals, 8, 40, "meal");
  if (meals.error) return { error: meals.error };
  const foods = stringList(input.foods, 12, 40, "food");
  if (foods.error) return { error: foods.error };
  const vibes = stringList(input.vibes, 12, 40, "vibe");
  if (vibes.error) return { error: vibes.error };
  const category = cleanLine(input.category, 80);
  if (category.error) return { error: "Keep the category under 80 characters." };
  const flags = [
    ["outdoor", "outdoor dining"],
    ["kids", "kid friendly"],
    ["music", "live music"],
    ["reservations", "reservations"],
    ["groups", "groups"],
    ["happyFood", "happy hour food"],
    ["happyDrinks", "happy hour drinks"],
    ["laurensFavorite", "Lauren’s Favorites"],
  ];
  const parsedFlags = {};
  for (const [key, name] of flags) {
    const parsed = flag(input[key], name);
    if (parsed.error) return { error: parsed.error };
    parsedFlags[key] = parsed.value;
  }
  const photos = validatePhotos(input.photos, allowedPhotoIds);
  if (photos.error) return { error: photos.error };
  const status = normalizeStatus(input.status);
  if (status.error) return { error: status.error };
  return {
    status: status.status,
    value: {
      name: name.text,
      area: area.text,
      areaSlug: slugify(area.text),
      subarea: subarea.text,
      label: label.text,
      address: address.text,
      lat: lat.value,
      lng: lng.value,
      phone: phone.text,
      website: website.text,
      facebook: facebook.text,
      instagram: instagram.text,
      price,
      notes: notes.text,
      hours: hours.text,
      cuisines: cuisines.value,
      meals: meals.value,
      foods: foods.value,
      vibes: vibes.value,
      category: category.text,
      ...parsedFlags,
      photos: photos.value,
    },
  };
}

export function searchText(listing) {
  return [
    listing.name,
    listing.area,
    listing.subarea,
    listing.label,
    ...(listing.cuisines || []),
    ...(listing.meals || []),
    ...(listing.foods || []),
    listing.category,
    listing.notes,
    listing.price,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function publicRecord(listing) {
  const cover = listing.photos && listing.photos[0] ? listing.photos[0].src : null;
  return {
    slug: listing.slug,
    name: listing.name,
    area: listing.area,
    areaSlug: listing.areaSlug || slugify(listing.area || ""),
    meals: listing.meals || [],
    cuisines: listing.cuisines || [],
    foods: listing.foods || [],
    price: listing.price || "",
    lat: listing.lat ?? null,
    lng: listing.lng ?? null,
    address: listing.address || "",
    phone: listing.phone || "",
    search: listing.source === "baseline" && listing.search ? listing.search : searchText(listing),
    label: listing.label || listing.area || "",
    outdoor: Boolean(listing.outdoor),
    kids: Boolean(listing.kids),
    music: Boolean(listing.music),
    reservations: Boolean(listing.reservations),
    groups: Boolean(listing.groups),
    happyFood: Boolean(listing.happyFood),
    happyDrinks: Boolean(listing.happyDrinks),
    laurensFavorite: Boolean(listing.laurensFavorite),
    image: cover,
  };
}
