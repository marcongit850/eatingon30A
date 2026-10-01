(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var DAYS = [
    ["Monday", "hoursMon", "hoursMonClosed"],
    ["Tuesday", "hoursTue", "hoursTueClosed"],
    ["Wednesday", "hoursWed", "hoursWedClosed"],
    ["Thursday", "hoursThu", "hoursThuClosed"],
    ["Friday", "hoursFri", "hoursFriClosed"],
    ["Saturday", "hoursSat", "hoursSatClosed"],
    ["Sunday", "hoursSun", "hoursSunClosed"],
  ];

  function status(form, message, isError) {
    var node = form.querySelector(".listing-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", Boolean(isError));
  }

  function field(form, name) {
    return form.querySelector('[name="' + name + '"]');
  }

  function value(form, name) {
    var node = field(form, name);
    return node ? String(node.value || "").trim() : "";
  }

  function checkedValues(form, name) {
    return Array.prototype.map.call(
      form.querySelectorAll('input[name="' + name + '"]:checked'),
      function (node) {
        return node.value;
      },
    );
  }

  function digits(text) {
    return String(text || "").replace(/\D/g, "");
  }

  function syncHours(form) {
    DAYS.forEach(function (day) {
      var closed = field(form, day[2]);
      var hours = field(form, day[1]);
      if (!closed || !hours) return;
      hours.disabled = closed.checked;
    });
  }

  function syncIntent(form) {
    var selected = form.querySelector('input[name="intent"]:checked');
    var listing = field(form, "existingListing");
    if (!listing) return;
    listing.required = Boolean(selected && selected.value === "update");
  }

  function payload(form) {
    var body = {
      eo30a_hp: value(form, "eo30a_hp"),
      name: value(form, "name"),
      role: (form.querySelector('input[name="role"]:checked') || {}).value || "",
      email: value(form, "email"),
      contactPhone: value(form, "contactPhone"),
      bestTime: value(form, "bestTime"),
      intent: (form.querySelector('input[name="intent"]:checked') || {}).value || "",
      existingListing: value(form, "existingListing"),
      restaurant: value(form, "restaurant"),
      area: value(form, "area"),
      address: value(form, "address"),
      restaurantPhone: value(form, "restaurantPhone"),
      website: value(form, "website"),
      price: (form.querySelector('input[name="price"]:checked') || {}).value || "",
      description: value(form, "description"),
      seasonalNote: value(form, "seasonalNote"),
      cuisines: checkedValues(form, "cuisines"),
      meals: checkedValues(form, "meals"),
      foods: checkedValues(form, "foods"),
      facebook: value(form, "facebook"),
      instagram: value(form, "instagram"),
      logoUrl: value(form, "logoUrl"),
      listPhotoUrl: value(form, "listPhotoUrl"),
      detailPhotoUrl: value(form, "detailPhotoUrl"),
      videoUrl: value(form, "videoUrl"),
      notes: value(form, "notes"),
      authorized: Boolean(field(form, "authorized") && field(form, "authorized").checked),
    };
    DAYS.forEach(function (day) {
      var closed = field(form, day[2]);
      body[day[1]] = value(form, day[1]);
      body[day[2]] = Boolean(closed && closed.checked);
    });
    ["outdoor", "happyDrinks", "happyFood", "reservations", "kids", "groups", "music"].forEach(function (name) {
      var node = field(form, name);
      body[name] = Boolean(node && node.checked);
    });
    return body;
  }

  function badLink(text) {
    return text.length > 300 || /\s/.test(text);
  }

  function invalid(body) {
    if (!body.name || body.name.length > 120) return { message: body.name ? "Keep your name under 120 characters." : "Enter your name.", field: "name" };
    if (body.role !== "owner" && body.role !== "manager" && body.role !== "marketing" && body.role !== "other") {
      return { message: "Choose your role.", field: "role" };
    }
    if (!EMAIL.test(body.email) || body.email.length > 200) return { message: "Enter a valid email.", field: "email" };
    if (body.contactPhone && (digits(body.contactPhone).length < 7 || body.contactPhone.length > 40)) {
      return { message: "Enter a valid phone number.", field: "contactPhone" };
    }
    if (body.bestTime.length > 120) return { message: "Keep the best time under 120 characters.", field: "bestTime" };
    if (body.intent !== "new" && body.intent !== "update") return { message: "Choose new listing or an update.", field: "intent" };
    if (body.intent === "update" && !body.existingListing) {
      return { message: "Add the current listing URL or the exact restaurant name.", field: "existingListing" };
    }
    if (body.existingListing.length > 300) return { message: "Keep the current listing under 300 characters.", field: "existingListing" };
    if (!body.restaurant || body.restaurant.length > 160) {
      return { message: body.restaurant ? "Keep the restaurant name under 160 characters." : "Enter a restaurant name.", field: "restaurant" };
    }
    if (!body.area) return { message: "Choose an area.", field: "area" };
    if (!body.address || body.address.length > 240) {
      return { message: body.address ? "Keep the street address under 240 characters." : "Enter the street address.", field: "address" };
    }
    if (!body.restaurantPhone || digits(body.restaurantPhone).length < 7 || body.restaurantPhone.length > 40) {
      return { message: "Enter the restaurant phone number.", field: "restaurantPhone" };
    }
    if (badLink(body.website)) return { message: "Check the website link.", field: "website" };
    if (body.price !== "$" && body.price !== "$$" && body.price !== "$$$" && body.price !== "$$$$") {
      return { message: "Choose a price range.", field: "price" };
    }
    if (!body.description) return { message: "Add a short description.", field: "description" };
    if (body.description.length > 2000) return { message: "Keep the description under 2,000 characters.", field: "description" };
    var dayProblem = null;
    DAYS.forEach(function (day) {
      if (dayProblem) return;
      if (!body[day[2]] && !body[day[1]]) dayProblem = { message: "Add hours for " + day[0] + ", or mark it closed.", field: day[1] };
      if (body[day[1]] && body[day[1]].length > 80) dayProblem = { message: "Keep " + day[0] + " hours under 80 characters.", field: day[1] };
    });
    if (dayProblem) return dayProblem;
    if (body.seasonalNote.length > 500) return { message: "Keep the seasonal note under 500 characters.", field: "seasonalNote" };
    if (!body.cuisines.length) return { message: "Choose at least one cuisine type.", field: "cuisines" };
    if (!body.meals.length) return { message: "Choose at least one meal.", field: "meals" };
    if (badLink(body.facebook)) return { message: "Check the Facebook link.", field: "facebook" };
    if (badLink(body.instagram)) return { message: "Check the Instagram link.", field: "instagram" };
    if (badLink(body.logoUrl)) return { message: "Check the logo link.", field: "logoUrl" };
    if (badLink(body.listPhotoUrl)) return { message: "Check the list photo link.", field: "listPhotoUrl" };
    if (badLink(body.detailPhotoUrl)) return { message: "Check the detail photo link.", field: "detailPhotoUrl" };
    if (badLink(body.videoUrl)) return { message: "Check the video link.", field: "videoUrl" };
    if (body.notes.length > 4000) return { message: "Keep the notes under 4,000 characters.", field: "notes" };
    if (!body.authorized) return { message: "Confirm you are authorized to submit for this restaurant.", field: "authorized" };
    return null;
  }

  function focusField(form, name) {
    var node = form.querySelector('[name="' + name + '"]');
    if (node && node.focus) node.focus();
  }

  function fillFromQuery(form) {
    var params = new URLSearchParams(window.location.search);
    var intent = params.get("intent");
    var restaurant = params.get("restaurant");
    var listing = params.get("listing");
    if (intent === "update" || intent === "new") {
      var radio = form.querySelector('input[name="intent"][value="' + intent + '"]');
      if (radio) radio.checked = true;
    }
    var restaurantField = field(form, "restaurant");
    if (restaurant && restaurantField && !restaurantField.value) {
      var max = restaurantField.maxLength > 0 ? restaurantField.maxLength : 160;
      restaurantField.value = restaurant.slice(0, max);
    }
    var listingField = field(form, "existingListing");
    if (listing && listingField && !listingField.value) {
      var listingMax = listingField.maxLength > 0 ? listingField.maxLength : 300;
      listingField.value = listing.slice(0, listingMax);
    }
    syncIntent(form);
  }

  function bind(form) {
    fillFromQuery(form);
    syncHours(form);
    form.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || !target.name) return;
      if (target.name === "intent") syncIntent(form);
      if (/Closed$/.test(target.name)) syncHours(form);
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var body = payload(form);
      var problem = invalid(body);
      if (problem) {
        status(form, problem.message, true);
        focusField(form, problem.field);
        return;
      }
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      status(form, "Sending…", false);
      fetch("/api/list-restaurant", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          }).catch(function () {
            return { ok: false, data: {} };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data.ok) {
            status(form, (result.data && result.data.error) || "The request could not be sent. Try again in a moment.", true);
            return;
          }
          form.reset();
          syncHours(form);
          syncIntent(form);
          status(form, "Thanks. We have your listing.", false);
        })
        .catch(function () {
          status(form, "The request could not be sent. Try again in a moment.", true);
        })
        .then(function () {
          if (button) button.disabled = false;
        });
    });
  }

  document.querySelectorAll("form[data-list-restaurant]").forEach(bind);
})();
