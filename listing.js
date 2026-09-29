(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function status(form, message, isError) {
    var node = form.querySelector(".listing-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", Boolean(isError));
  }

  function payload(form) {
    var data = new FormData(form);
    var type = data.get("type");
    return {
      restaurant: String(data.get("restaurant") || "").trim(),
      type: type ? String(type) : "",
      details: String(data.get("details") || "").trim(),
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
    };
  }

  function invalid(body) {
    if (!body.name || body.name.length > 120) return { message: "Enter your name.", field: "name" };
    if (!EMAIL.test(body.email) || body.email.length > 200) return { message: "Enter a valid email.", field: "email" };
    if (!body.restaurant || body.restaurant.length > 160) return { message: "Enter the restaurant name.", field: "restaurant" };
    if (body.type !== "update" && body.type !== "edit" && body.type !== "deletion" && body.type !== "new") {
      return { message: "Choose update, edit, deletion, or new listing.", field: "type" };
    }
    if (!body.details) return { message: "Tell us what should change.", field: "details" };
    if (body.details.length > 4000) return { message: "Keep the details under 4,000 characters.", field: "details" };
    return null;
  }

  function bind(form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var body = payload(form);
      var problem = invalid(body);
      if (problem) {
        status(form, problem.message, true);
        var field = form.querySelector('[name="' + problem.field + '"]');
        if (field) field.focus();
        return;
      }
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      status(form, "Sending…", false);
      fetch("/api/listing", {
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
            status(form, result.data.error || "The request could not be sent. Try again in a moment.", true);
            return;
          }
          form.reset();
          status(form, "Thanks. We have your note.", false);
        })
        .catch(function () {
          status(form, "The request could not be sent. Try again in a moment.", true);
        })
        .then(function () {
          if (button) button.disabled = false;
        });
    });
  }

  document.querySelectorAll("form[data-listing]").forEach(bind);
})();
