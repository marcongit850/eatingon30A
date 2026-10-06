(function () {
  var root = document.getElementById("admin-root");
  if (!root) return;

  var state = {
    user: null,
    ready: false,
    options: null,
    site: "30a",
    query: "",
    listings: [],
    listing: null,
    mode: "gate",
    message: "",
    error: false,
    busy: false,
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char];
    });
  }

  function api(path, options) {
    var init = options || {};
    init.credentials = "same-origin";
    return fetch(path, init).then(function (response) {
      var type = response.headers.get("content-type") || "";
      if (type.indexOf("json") === -1) {
        return response.text().then(function () {
          return { ok: response.ok, status: response.status, body: { ok: false, error: "The admin could not be reached." } };
        });
      }
      return response.json().then(function (body) {
        return { ok: response.ok, status: response.status, body: body };
      });
    });
  }

  function siteLabel() {
    if (!state.options) return state.site === "destin" ? "Eating in Destin" : "Eating on 30A";
    var match = state.options.sites.filter(function (site) { return site.id === state.site; })[0];
    return match ? match.label : state.site;
  }

  function areas() {
    if (!state.options) return [];
    var match = state.options.sites.filter(function (site) { return site.id === state.site; })[0];
    return match && match.areas ? match.areas.slice() : [];
  }

  function showMessage(text, isError) {
    state.message = text || "";
    state.error = Boolean(isError);
    render();
  }

  function blankListing() {
    return {
      site: state.site,
      slug: "",
      status: "live",
      name: "",
      area: "",
      subarea: "",
      label: "",
      address: "",
      lat: "",
      lng: "",
      phone: "",
      website: "",
      facebook: "",
      instagram: "",
      price: "",
      notes: "",
      hours: "",
      cuisines: [],
      meals: [],
      foods: [],
      vibes: [],
      category: "",
      outdoor: false,
      kids: false,
      music: false,
      reservations: false,
      groups: false,
      happyFood: false,
      happyDrinks: false,
      laurensFavorite: false,
      photos: [],
      logo: "",
    };
  }

  function field(name, label, value, extra) {
    var type = (extra && extra.type) || "text";
    var wide = extra && extra.wide ? " wide" : "";
    if (type === "textarea") {
      return '<label class="field wide"><span>' + label + '</span><textarea name="' + name + '" rows="' + (extra.rows || 4) + '">' + escapeHtml(value || "") + "</textarea></label>";
    }
    return '<label class="field' + wide + '"><span>' + label + '</span><input name="' + name + '" type="' + type + '" value="' + escapeHtml(value == null ? "" : value) + '"' + (extra && extra.placeholder ? ' placeholder="' + escapeHtml(extra.placeholder) + '"' : "") + "></label>";
  }

  function select(name, label, value, options, wide) {
    var html = options.map(function (option) {
      var selected = option.value === value ? " selected" : "";
      return '<option value="' + escapeHtml(option.value) + '"' + selected + ">" + escapeHtml(option.label) + "</option>";
    }).join("");
    return '<label class="field' + (wide ? " wide" : "") + '"><span>' + label + '</span><select name="' + name + '">' + html + "</select></label>";
  }

  function checks(name, label, options, selected) {
    var current = selected || [];
    var boxes = options.map(function (option) {
      var on = current.indexOf(option) !== -1 ? " checked" : "";
      return '<label class="check"><input type="checkbox" name="' + name + '" value="' + escapeHtml(option) + '"' + on + "><span>" + escapeHtml(option) + "</span></label>";
    }).join("");
    return '<fieldset class="wide"><legend>' + label + '</legend><div class="checks admin-checks">' + boxes + "</div></fieldset>";
  }

  function flag(name, label, on) {
    return '<label class="check"><input type="checkbox" name="' + name + '" value="yes"' + (on ? " checked" : "") + "><span>" + label + "</span></label>";
  }

  function renderGate() {
    if (!state.ready) return "<p>Loading…</p>";
    if (state.user && !state.user.isAdmin) {
      return "<p>This account cannot edit listings. Sign in with the admin email.</p>";
    }
    return (
      '<p class="admin-lead">Sign in with the admin email. The same magic link works for Eating on 30A and Eating in Destin.</p>' +
      '<form class="listing-form" data-signin><label class="field"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>' +
      '<button class="button" type="submit">Email me a sign-in link</button>' +
      '<p class="admin-message" data-error="' + (state.error ? "true" : "false") + '">' + escapeHtml(state.message) + "</p></form>"
    );
  }

  function renderList() {
    var q = state.query.trim().toLowerCase();
    var rows = state.listings.filter(function (listing) {
      if (!q) return true;
      return (listing.name + " " + listing.area + " " + listing.slug).toLowerCase().indexOf(q) !== -1;
    });
    var body = rows.map(function (listing) {
      var badge = listing.status === "draft" ? "badge badge-draft" : "badge";
      var label = listing.status === "draft" ? "Draft" : "Live";
      return "<tr><td><a href=\"#\" data-edit=\"" + escapeHtml(listing.slug) + "\">" + escapeHtml(listing.name) + "</a></td><td>" + escapeHtml(listing.area) + "</td><td><span class=\"" + badge + "\">" + label + "</span></td><td>" + listing.photoCount + "</td></tr>";
    }).join("");
    if (!body) body = '<tr><td colspan="4">No listings match.</td></tr>';
    var sites = (state.options ? state.options.sites : []).map(function (site) {
      var pressed = site.id === state.site ? "true" : "false";
      return '<button type="button" class="button secondary" data-site="' + site.id + '" aria-pressed="' + pressed + '">' + escapeHtml(site.label) + "</button>";
    }).join("");
    return (
      '<p class="admin-lead">Edits to ' + escapeHtml(siteLabel()) + " go live when you save. Choose Draft to hide a listing from the public guide.</p>" +
      '<div class="admin-bar"><div class="admin-sites" role="group" aria-label="Guide">' + sites + "</div>" +
      '<button type="button" class="button" data-new>New listing</button></div>' +
      '<label class="field"><span>Search</span><input id="admin-search" type="search" value="' + escapeHtml(state.query) + '" placeholder="Name or town"></label>' +
      '<p class="admin-message" data-error="' + (state.error ? "true" : "false") + '">' + escapeHtml(state.message) + "</p>" +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Restaurant</th><th>Area</th><th>Status</th><th>Photos</th></tr></thead><tbody>' + body + "</tbody></table></div>"
    );
  }

  function renderEditor() {
    var listing = state.listing || blankListing();
    var areaOptions = areas();
    if (listing.area && areaOptions.indexOf(listing.area) === -1) areaOptions = [listing.area].concat(areaOptions);
    var areaField = areaOptions.length
      ? select("area", "Area of town", listing.area, [{ value: "", label: "Choose a town" }].concat(areaOptions.map(function (area) { return { value: area, label: area }; })), true)
      : field("area", "Area of town", listing.area, { wide: true, placeholder: "Town or neighborhood" });
    var photos = (listing.photos || []).map(function (photo, index) {
      var src = photo.src || "";
      var thumb = src ? '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(listing.name || "Listing photo") + '">' : "<span class=\"ph\"></span>";
      return '<div class="photo-row">' + thumb + "<div><p>" + (index === 0 ? "Cover" : "Photo " + (index + 1)) + "</p></div><div class=\"photo-actions\">" +
        '<button type="button" class="button secondary" data-photo-up="' + index + '"' + (index === 0 ? " disabled" : "") + ">Up</button>" +
        '<button type="button" class="button secondary" data-photo-down="' + index + '"' + (index === listing.photos.length - 1 ? " disabled" : "") + ">Down</button>" +
        '<button type="button" class="button secondary" data-photo-delete="' + index + '">Delete</button></div></div>';
    }).join("");
    var photoNote = listing.slug
      ? "The first photo is the cover. JPEG, PNG, or WebP, up to 5 MB."
      : "Save the listing, then add photos.";
    return (
      '<p><button type="button" class="button secondary" data-back>All listings</button></p>' +
      "<h2>" + escapeHtml(listing.slug ? listing.name : "New listing") + "</h2>" +
      '<p class="admin-lead">' + escapeHtml(siteLabel()) + ". Live is the public guide. Draft stays hidden.</p>" +
      '<form class="listing-form admin-editor" data-editor>' +
      '<div class="admin-grid">' +
      field("name", "Restaurant name", listing.name, { wide: true }) +
      select("status", "Status", listing.status || "live", [{ value: "live", label: "Live" }, { value: "draft", label: "Draft" }]) +
      select("price", "Price", listing.price || "", [{ value: "", label: "Not set" }, { value: "$", label: "$" }, { value: "$$", label: "$$" }, { value: "$$$", label: "$$$" }, { value: "$$$$", label: "$$$$" }]) +
      areaField +
      field("subarea", "Subarea", listing.subarea) +
      field("label", "Location label", listing.label, { wide: true, placeholder: "Shown on the card when it differs from the town" }) +
      field("address", "Address", listing.address, { wide: true }) +
      field("lat", "Latitude", listing.lat, { type: "text" }) +
      field("lng", "Longitude", listing.lng, { type: "text" }) +
      field("phone", "Phone", listing.phone) +
      field("website", "Website", listing.website) +
      field("instagram", "Instagram", listing.instagram) +
      field("facebook", "Facebook", listing.facebook) +
      field("category", "Category", listing.category) +
      field("hours", "Hours", listing.hours, { type: "textarea", rows: 4 }) +
      field("notes", "Description", listing.notes, { type: "textarea", rows: 6 }) +
      field("vibes", "Vibes", (listing.vibes || []).join(", "), { wide: true, placeholder: "Comma separated" }) +
      "</div>" +
      checks("cuisines", "Cuisines", state.options.cuisines, listing.cuisines) +
      checks("meals", "Meals", state.options.meals, listing.meals) +
      checks("foods", "Foods", state.options.foods, listing.foods) +
      '<fieldset><legend>Details</legend><div class="checks admin-checks">' +
      flag("outdoor", "Outdoor dining", listing.outdoor) +
      flag("kids", "Kid friendly", listing.kids) +
      flag("music", "Live music", listing.music) +
      flag("reservations", "Takes reservations", listing.reservations) +
      flag("groups", "Good for groups 12+", listing.groups) +
      flag("happyFood", "Happy hour food", listing.happyFood) +
      flag("happyDrinks", "Happy hour drinks", listing.happyDrinks) +
      flag("laurensFavorite", "Lauren’s Favorites", listing.laurensFavorite) +
      "</div></fieldset>" +
      '<div class="admin-actions"><button class="button" type="submit">Save</button>' +
      (listing.slug && listing.status !== "draft" && state.site === "30a" ? '<a class="button secondary" href="/restaurants/' + escapeHtml(listing.slug) + '/">View</a>' : "") +
      (listing.slug ? '<button type="button" class="button secondary" data-delete>Delete</button>' : "") +
      "</div>" +
      '<p class="admin-message" data-error="' + (state.error ? "true" : "false") + '">' + escapeHtml(state.message) + "</p>" +
      "</form>" +
      '<section class="admin-section"><h2>Photos</h2><p class="admin-lead">' + photoNote + "</p>" +
      '<div class="photo-list">' + (photos || "<p>No photos yet.</p>") + "</div>" +
      (listing.slug ? '<form data-photo><label class="field"><span>Add a photo</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="button" type="submit">Upload</button></form>' : "") +
      "</section>"
    );
  }

  function render() {
    var focus = document.activeElement && document.activeElement.id === "admin-search";
    var selectionStart = focus ? document.activeElement.selectionStart : 0;
    if (state.mode === "gate") root.innerHTML = renderGate();
    else if (state.mode === "edit") root.innerHTML = renderEditor();
    else root.innerHTML = renderList();
    if (focus) {
      var input = document.getElementById("admin-search");
      if (input) {
        input.focus();
        if (input.setSelectionRange) input.setSelectionRange(selectionStart, selectionStart);
      }
    }
  }

  function readChecks(form, name) {
    return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (input) {
      return input.value;
    });
  }

  function readFlag(form, name) {
    var input = form.querySelector('input[name="' + name + '"]');
    return Boolean(input && input.checked);
  }

  function readListing(form) {
    var data = new FormData(form);
    var value = function (name) { return String(data.get(name) || "").trim(); };
    var listing = state.listing || blankListing();
    return {
      site: state.site,
      slug: listing.slug,
      status: value("status") || "live",
      name: value("name"),
      area: value("area"),
      subarea: value("subarea"),
      label: value("label"),
      address: value("address"),
      lat: value("lat"),
      lng: value("lng"),
      phone: value("phone"),
      website: value("website"),
      facebook: value("facebook"),
      instagram: value("instagram"),
      price: value("price"),
      notes: String(data.get("notes") || "").trim(),
      hours: String(data.get("hours") || "").trim(),
      cuisines: readChecks(form, "cuisines"),
      meals: readChecks(form, "meals"),
      foods: readChecks(form, "foods"),
      vibes: value("vibes") ? value("vibes").split(",").map(function (item) { return item.trim(); }).filter(Boolean) : [],
      category: value("category"),
      outdoor: readFlag(form, "outdoor"),
      kids: readFlag(form, "kids"),
      music: readFlag(form, "music"),
      reservations: readFlag(form, "reservations"),
      groups: readFlag(form, "groups"),
      happyFood: readFlag(form, "happyFood"),
      happyDrinks: readFlag(form, "happyDrinks"),
      laurensFavorite: readFlag(form, "laurensFavorite"),
      photos: listing.photos || [],
      logo: listing.logo || "",
    };
  }

  function loadList() {
    return api("/api/admin/listings?site=" + encodeURIComponent(state.site)).then(function (result) {
      if (!result.ok) {
        showMessage(result.body.error || "The listings could not be loaded.", true);
        return;
      }
      state.listings = result.body.listings || [];
      state.mode = "list";
      state.message = "";
      render();
    });
  }

  function openListing(slug) {
    state.busy = true;
    api("/api/admin/listings/" + encodeURIComponent(slug) + "?site=" + encodeURIComponent(state.site)).then(function (result) {
      state.busy = false;
      if (!result.ok) {
        showMessage(result.body.error || "That listing was not found.", true);
        return;
      }
      state.listing = result.body.listing;
      state.mode = "edit";
      state.message = "";
      render();
    });
  }

  function saveListing(form) {
    var body = readListing(form);
    state.listing = body;
    var creating = !body.slug;
    var path = creating ? "/api/admin/listings" : "/api/admin/listings/" + encodeURIComponent(body.slug);
    return api(path, {
      method: creating ? "POST" : "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (result) {
      if (!result.ok) {
        showMessage(result.body.error || "That listing could not be saved.", true);
        return;
      }
      var saved = result.body.listing;
      state.listing = {
        site: state.site,
        slug: saved.slug,
        status: saved.status,
        photos: (saved.payload && saved.payload.photos) || body.photos,
        logo: (saved.payload && saved.payload.logo) || body.logo,
      };
      Object.keys(saved.payload || {}).forEach(function (key) {
        state.listing[key] = saved.payload[key];
      });
      state.listing.slug = saved.slug;
      state.listing.status = saved.status;
      state.listing.site = state.site;
      showMessage(saved.status === "draft" ? "Saved as draft. It is hidden from the guide." : "Saved live.", false);
    });
  }

  function syncPhotos(photos) {
    if (!state.listing) return;
    state.listing.photos = photos;
    render();
  }

  function captureForm() {
    var form = root.querySelector("[data-editor]");
    if (form) state.listing = readListing(form);
  }

  function movePhoto(index, delta) {
    captureForm();
    var photos = (state.listing.photos || []).slice();
    var next = index + delta;
    if (next < 0 || next >= photos.length) return;
    var item = photos[index];
    photos[index] = photos[next];
    photos[next] = item;
    api("/api/admin/listings/" + encodeURIComponent(state.listing.slug) + "/photos", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: state.site, photos: photos }),
    }).then(function (result) {
      if (!result.ok) {
        showMessage(result.body.error || "Those photos could not be reordered.", true);
        return;
      }
      state.message = "";
      syncPhotos(result.body.photos || photos);
    });
  }

  function deletePhoto(index) {
    captureForm();
    var photo = state.listing.photos[index];
    if (!photo) return;
    if (photo.id) {
      api("/api/admin/listings/" + encodeURIComponent(state.listing.slug) + "/photos/" + encodeURIComponent(photo.id) + "?site=" + encodeURIComponent(state.site), {
        method: "DELETE",
      }).then(function (result) {
        if (!result.ok) {
          showMessage(result.body.error || "That photo could not be deleted.", true);
          return;
        }
        state.message = "";
        syncPhotos(result.body.photos || []);
      });
      return;
    }
    var photos = state.listing.photos.filter(function (item, itemIndex) { return itemIndex !== index; });
    api("/api/admin/listings/" + encodeURIComponent(state.listing.slug) + "/photos", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site: state.site, photos: photos }),
    }).then(function (result) {
      if (!result.ok) {
        showMessage(result.body.error || "That photo could not be deleted.", true);
        return;
      }
      state.message = "";
      syncPhotos(result.body.photos || photos);
    });
  }

  root.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.hasAttribute("data-signin")) {
      event.preventDefault();
      var email = new FormData(form).get("email");
      api("/api/account/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email, next: "/admin/" }),
      }).then(function (result) {
        if (!result.ok) showMessage((result.body && result.body.error) || "The sign-in email could not be sent.", true);
        else showMessage("Check your email for the sign-in link.", false);
      });
      return;
    }
    if (form.hasAttribute("data-editor")) {
      event.preventDefault();
      saveListing(form);
      return;
    }
    if (form.hasAttribute("data-photo")) {
      event.preventDefault();
      var file = form.querySelector('input[name="file"]').files[0];
      captureForm();
      if (!file || !state.listing || !state.listing.slug) return;
      var body = new FormData();
      body.set("site", state.site);
      body.set("status", state.listing.status || "live");
      body.set("file", file);
      api("/api/admin/listings/" + encodeURIComponent(state.listing.slug) + "/photos", { method: "POST", body: body }).then(function (result) {
        if (!result.ok) {
          showMessage(result.body.error || "That photo could not be saved.", true);
          return;
        }
        form.reset();
        state.message = "Photo added.";
        state.error = false;
        syncPhotos(result.body.photos || []);
      });
    }
  });

  root.addEventListener("click", function (event) {
    var edit = event.target.closest("[data-edit]");
    if (edit) {
      event.preventDefault();
      openListing(edit.getAttribute("data-edit"));
      return;
    }
    var site = event.target.closest("[data-site]");
    if (site) {
      state.site = site.getAttribute("data-site");
      state.query = "";
      loadList();
      return;
    }
    if (event.target.closest("[data-new]")) {
      state.listing = blankListing();
      state.mode = "edit";
      state.message = "";
      render();
      return;
    }
    if (event.target.closest("[data-back]")) {
      loadList();
      return;
    }
    if (event.target.closest("[data-delete]")) {
      if (!state.listing || !state.listing.slug) return;
      if (!window.confirm("Delete " + state.listing.name + "? It will leave the public guide.")) return;
      api("/api/admin/listings/" + encodeURIComponent(state.listing.slug) + "?site=" + encodeURIComponent(state.site), { method: "DELETE" }).then(function (result) {
        if (!result.ok) {
          showMessage(result.body.error || "That listing could not be deleted.", true);
          return;
        }
        loadList();
      });
      return;
    }
    var up = event.target.closest("[data-photo-up]");
    if (up) movePhoto(Number(up.getAttribute("data-photo-up")), -1);
    var down = event.target.closest("[data-photo-down]");
    if (down) movePhoto(Number(down.getAttribute("data-photo-down")), 1);
    var remove = event.target.closest("[data-photo-delete]");
    if (remove) deletePhoto(Number(remove.getAttribute("data-photo-delete")));
  });

  root.addEventListener("input", function (event) {
    if (event.target.id !== "admin-search") return;
    state.query = event.target.value;
    render();
  });

  api("/api/account/me").then(function (result) {
    state.ready = true;
    state.user = result.body && result.body.user;
    if (!state.user || !state.user.isAdmin) {
      state.mode = "gate";
      render();
      return;
    }
    return api("/api/admin/options").then(function (options) {
      if (!options.ok) {
        state.mode = "gate";
        showMessage(options.body.error || "The admin could not be loaded.", true);
        return;
      }
      state.options = options.body;
      var params = new URLSearchParams(location.search);
      if (params.get("site") === "destin" || params.get("site") === "30a") state.site = params.get("site");
      return loadList();
    });
  }).catch(function () {
    state.ready = true;
    state.mode = "gate";
    showMessage("The admin could not be loaded.", true);
  });
})();
