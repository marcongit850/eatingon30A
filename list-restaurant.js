(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  var MAX_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024;
  var MAX_IMAGE_COUNT = 12;

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
      hours: value(form, "hours"),
      seasonalNote: value(form, "seasonalNote"),
      cuisines: checkedValues(form, "cuisines"),
      meals: checkedValues(form, "meals"),
      foods: checkedValues(form, "foods"),
      facebook: value(form, "facebook"),
      instagram: value(form, "instagram"),
      videoUrl: value(form, "videoUrl"),
      notes: value(form, "notes"),
      authorized: Boolean(field(form, "authorized") && field(form, "authorized").checked),
    };
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
    if (body.role && body.role !== "owner" && body.role !== "manager" && body.role !== "marketing" && body.role !== "other") {
      return { message: "Choose your role.", field: "role" };
    }
    if (!EMAIL.test(body.email) || body.email.length > 200) return { message: "Enter a valid email.", field: "email" };
    if (body.contactPhone && (digits(body.contactPhone).length < 7 || body.contactPhone.length > 40)) {
      return { message: "Enter a valid phone number.", field: "contactPhone" };
    }
    if (body.bestTime.length > 120) return { message: "Keep the best time under 120 characters.", field: "bestTime" };
    if (body.intent && body.intent !== "new" && body.intent !== "update") return { message: "Choose new listing or an update.", field: "intent" };
    if (body.existingListing.length > 300) return { message: "Keep the current listing under 300 characters.", field: "existingListing" };
    if (body.restaurant.length > 160) return { message: "Keep the restaurant name under 160 characters.", field: "restaurant" };
    if (body.address.length > 240) return { message: "Keep the street address under 240 characters.", field: "address" };
    if (body.restaurantPhone && (digits(body.restaurantPhone).length < 7 || body.restaurantPhone.length > 40)) {
      return { message: "Enter the restaurant phone number.", field: "restaurantPhone" };
    }
    if (badLink(body.website)) return { message: "Check the website link.", field: "website" };
    if (body.price && body.price !== "$" && body.price !== "$$" && body.price !== "$$$" && body.price !== "$$$$") {
      return { message: "Choose a price range.", field: "price" };
    }
    if (body.description.length > 2000) return { message: "Keep the description under 2,000 characters.", field: "description" };
    if (body.hours.length > 1000) return { message: "Keep the hours under 1,000 characters.", field: "hours" };
    if (body.seasonalNote.length > 500) return { message: "Keep the seasonal note under 500 characters.", field: "seasonalNote" };
    if (badLink(body.facebook)) return { message: "Check the Facebook link.", field: "facebook" };
    if (badLink(body.instagram)) return { message: "Check the Instagram link.", field: "instagram" };
    if (badLink(body.videoUrl)) return { message: "Check the video link.", field: "videoUrl" };
    if (body.notes.length > 4000) return { message: "Keep the notes under 4,000 characters.", field: "notes" };
    return null;
  }

  function imageIssue(file) {
    if (!file || !file.name) return "Use a JPEG, PNG, or WebP image.";
    var type = String(file.type || "").toLowerCase().split(";")[0].trim();
    if (type === "image/jpg" || type === "image/pjpeg") type = "image/jpeg";
    var typed = type === "image/jpeg" || type === "image/png" || type === "image/webp";
    var ext = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (type && type !== "application/octet-stream" && !typed) return "Use a JPEG, PNG, or WebP image.";
    if (!typed && !ext) return "Use a JPEG, PNG, or WebP image.";
    if (file.size > MAX_IMAGE_BYTES) return "That file is too large. Keep each image under 2 MB.";
    if (!file.size) return "Use a JPEG, PNG, or WebP image.";
    return "";
  }

  function imageProblem(files) {
    if (files.length > MAX_IMAGE_COUNT) return "Keep it to 12 images.";
    var total = 0;
    for (var i = 0; i < files.length; i++) {
      var issue = imageIssue(files[i]);
      if (issue) return issue;
      total += files[i].size || 0;
    }
    if (total > MAX_IMAGE_TOTAL_BYTES) return "Those images are too large to send. Keep them under 8 MB altogether.";
    return "";
  }

  function imageFiles(form) {
    return form._listingImages || [];
  }

  function sniffFile(file) {
    return file.slice(0, 12).arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
      if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
      ) return "image/png";
      if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      ) return "image/webp";
      return "";
    }).catch(function () {
      return "";
    });
  }

  function renderImages(form) {
    var list = form.querySelector(".media-files");
    if (!list) return;
    var files = imageFiles(form);
    list.textContent = "";
    files.forEach(function (file, index) {
      var item = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = file.name;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        var next = imageFiles(form).slice();
        next.splice(index, 1);
        setImageFiles(form, next);
      });
      item.appendChild(name);
      item.appendChild(remove);
      list.appendChild(item);
    });
    list.hidden = files.length === 0;
  }

  function setImageFiles(form, files) {
    form._listingImages = files;
    renderImages(form);
  }

  function showImageError(form, message) {
    var note = form.querySelector(".media-error");
    if (!note) return;
    note.textContent = message || "";
    note.hidden = !message;
  }

  function addImages(form, fileList) {
    var incoming = Array.prototype.filter.call(fileList || [], function (file) {
      return file && (file.name || file.size);
    });
    if (!incoming.length) return form._listingPending || Promise.resolve();
    var accepted = [];
    var problem = "";
    var chain = Promise.resolve();
    incoming.forEach(function (file) {
      chain = chain.then(function () {
        var issue = imageIssue(file);
        if (issue) {
          if (!problem) problem = issue;
          return;
        }
        return sniffFile(file).then(function (kind) {
          if (!kind) {
            if (!problem) problem = "Use a JPEG, PNG, or WebP image.";
            return;
          }
          accepted.push(file);
        });
      });
    });
    var previous = form._listingPending || Promise.resolve();
    form._listingPending = previous.then(function () {
      return chain;
    }).then(function () {
      var next = imageFiles(form).concat(accepted);
      if (next.length > MAX_IMAGE_COUNT) {
        showImageError(form, "Keep it to 12 images.");
        focusField(form, "photos");
        return;
      }
      var total = 0;
      next.forEach(function (file) {
        total += file.size || 0;
      });
      if (total > MAX_IMAGE_TOTAL_BYTES) {
        showImageError(form, "Those images are too large to send. Keep them under 8 MB altogether.");
        focusField(form, "photos");
        return;
      }
      if (accepted.length) setImageFiles(form, next);
      if (problem) {
        showImageError(form, problem);
        focusField(form, "photos");
        return;
      }
      showImageError(form, "");
    });
    return form._listingPending;
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
  }

  function bindImages(form) {
    var zone = form.querySelector(".media-drop");
    var photoInput = field(form, "photos");
    if (zone) {
      zone.addEventListener("dragenter", function (event) {
        event.preventDefault();
        zone.classList.add("is-dragover");
      });
      zone.addEventListener("dragover", function (event) {
        event.preventDefault();
        zone.classList.add("is-dragover");
      }, true);
      zone.addEventListener("dragleave", function (event) {
        if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
        zone.classList.remove("is-dragover");
      });
      zone.addEventListener("drop", function (event) {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove("is-dragover");
        var files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) addImages(form, files);
      }, true);
    }
    if (photoInput) {
      photoInput.addEventListener("change", function () {
        addImages(form, photoInput.files);
        photoInput.value = "";
      });
    }
  }

  function bind(form) {
    fillFromQuery(form);
    bindImages(form);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var pending = form._listingPending || Promise.resolve();
      pending.then(function () {
        sendListing(form);
      });
    });
  }

  function sendListing(form) {
    if (form._listingSending) return;
    var body = payload(form);
    var problem = invalid(body);
    var images = imageFiles(form);
    var imageError = imageProblem(images);
    if (problem || imageError) {
      showImageError(form, imageError);
      status(form, problem ? problem.message : imageError, true);
      focusField(form, problem ? problem.field : "photos");
      return;
    }
    showImageError(form, "");
    var button = form.querySelector('button[type="submit"]');
    form._listingSending = true;
    if (button) button.disabled = true;
    status(form, "Sending…", false);
    var data = new FormData(form);
    data.delete("photos");
    images.forEach(function (file) {
      data.append("photos", file, file.name);
    });
    fetch("/api/list-restaurant", {
      method: "POST",
      headers: { accept: "application/json" },
      body: data,
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          return { ok: response.ok, data: payload };
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
        setImageFiles(form, []);
        status(form, "Thanks!  We will review and get back to you shortly.", false);
      })
      .catch(function () {
        status(form, "The request could not be sent. Try again in a moment.", true);
      })
      .then(function () {
        form._listingSending = false;
        if (button) button.disabled = false;
      });
  }

  document.querySelectorAll("form[data-list-restaurant]").forEach(bind);
})();
