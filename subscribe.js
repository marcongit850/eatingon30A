(function () {
  var DISMISS = "eo30a-coupon-popup";
  var SID = "eo30a-sid";
  var START = "eo30a-visit-start";
  var DELAY = 30000;

  function storage(name) {
    try {
      return window[name];
    } catch (error) {
      return null;
    }
  }

  function sid() {
    var box = storage("sessionStorage");
    if (!box) return "session";
    var id = box.getItem(SID);
    if (!id) {
      id = String(Date.now());
      box.setItem(SID, id);
    }
    return id;
  }

  function dismissed() {
    var box = storage("localStorage");
    if (!box) return false;
    return box.getItem(DISMISS) === sid();
  }

  function remember() {
    var box = storage("localStorage");
    if (!box) return;
    box.setItem(DISMISS, sid());
  }

  function visitStart() {
    var box = storage("sessionStorage");
    var now = Date.now();
    if (!box) return now;
    var saved = Number(box.getItem(START));
    if (!saved) {
      box.setItem(START, String(now));
      return now;
    }
    return saved;
  }

  function status(form, message, isError) {
    var node = form.querySelector(".subscribe-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", Boolean(isError));
  }

  function payload(form) {
    var data = new FormData(form);
    var audience = data.get("audience");
    return {
      email: String(data.get("email") || "").trim(),
      audience: audience ? String(audience) : "",
      coupons: data.get("coupons") === "yes",
    };
  }

  function bind(form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var body = payload(form);
      if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        status(form, "Enter a valid email.", true);
        var field = form.querySelector('input[type="email"]');
        if (field) field.focus();
        return;
      }
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      status(form, "Sending…", false);
      fetch("/api/subscribe", {
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
            status(form, result.data.error || "The signup could not be sent. Try again in a moment.", true);
            return;
          }
          form.reset();
          status(form, result.data.delivered
            ? "Thanks. We’ll send coupons or updates to that address."
            : "Thanks. We have your signup.", false);
          remember();
          var dialog = document.getElementById("subscribe-popup");
          if (dialog && dialog.open && form.closest("#subscribe-popup")) dialog.close();
        })
        .catch(function () {
          status(form, "The signup could not be sent. Try again in a moment.", true);
        })
        .then(function () {
          if (button) button.disabled = false;
        });
    });
  }

  document.querySelectorAll("form[data-subscribe]").forEach(bind);

  var dialog = document.getElementById("subscribe-popup");
  if (!dialog || typeof dialog.showModal !== "function") return;
  dialog.querySelectorAll("[data-subscribe-close]").forEach(function (button) {
    button.addEventListener("click", function () {
      remember();
      dialog.close();
    });
  });
  dialog.addEventListener("cancel", function () {
    remember();
  });

  var configPromise = null;
  var mePromise = null;

  function config() {
    if (!configPromise) {
      configPromise = fetch("/api/account/config", { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .catch(function () { return { ok: false, site: "", accountsOrigin: "" }; });
    }
    return configPromise;
  }

  function me() {
    if (!mePromise) {
      mePromise = fetch("/api/account/me", { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .catch(function () { return { user: null }; });
    }
    return mePromise;
  }

  function navShowsPlaces() {
    var link = document.querySelector("[data-account-nav]");
    if (!link) return false;
    return (link.textContent || "").replace(/\s+/g, " ").trim() === "My places";
  }

  if (dismissed()) return;
  var path = location.pathname;
  if (path === "/my-places" || path === "/my-places/") return;
  if (navShowsPlaces()) return;
  var session = Promise.all([me(), config()]);
  var wait = Math.max(0, DELAY - (Date.now() - visitStart()));
  window.setTimeout(function () {
    if (dismissed() || dialog.open || navShowsPlaces()) return;
    session.then(function (parts) {
      if (dismissed() || dialog.open || navShowsPlaces()) return;
      var payload = parts[0];
      if (payload && payload.user) return;
      dialog.showModal();
    });
  }, wait);
})();
