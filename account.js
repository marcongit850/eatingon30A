(function () {
  var ORIGINS = {
    "30a": "https://www.eatingon30a.com",
    destin: "https://www.eatingindestin.com"
  };
  var LABELS = { "30a": "30A", destin: "Destin" };
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

  function refreshMe() {
    mePromise = null;
    return me();
  }

  function icon(kind, on) {
    var fill = on ? "currentColor" : "none";
    if (kind === "favorite") {
      return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" fill="' + fill + '" stroke="currentColor" stroke-width="1.6"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V5.5a1 1 0 0 1 1-1z" fill="' + fill + '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path></svg>';
  }

  function refreshNav() {
    var link = document.querySelector("[data-account-nav]");
    if (!link) return;
    me().then(function (payload) {
      if (payload && payload.user) {
        link.textContent = "My places";
        link.setAttribute("href", "/my-places/");
      } else {
        link.textContent = "Sign in";
        link.setAttribute("href", "/account/");
      }
      var path = location.pathname;
      if (path.length > 1 && path.endsWith("/")) path = path;
      else if (path !== "/") path = path + "/";
      var href = link.getAttribute("href");
      if (path === href) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function listingSlug() {
    var parts = location.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "restaurants") return parts[1];
    return "";
  }

  function placeHref(save, current) {
    var path = "/restaurants/" + encodeURIComponent(save.slug) + "/";
    if (save.site === current) return path;
    return (ORIGINS[save.site] || "") + path;
  }

  function signInHref() {
    return "/account/?next=" + encodeURIComponent(location.pathname);
  }

  function mountSaves() {
    var slug = listingSlug();
    var head = document.querySelector("article.profile .profile-head");
    if (!slug || !head || head.querySelector(".save-bar")) return;
    var title = head.querySelector("h1");
    if (!title) return;
    var areaLink = head.querySelector(".eyebrow a");
    var name = title.textContent.replace(/\s+/g, " ").trim();
    var area = areaLink ? areaLink.textContent.replace(/\s+/g, " ").trim() : "";
    var bar = document.createElement("div");
    bar.className = "save-bar";
    bar.innerHTML = buttonHtml("favorite", false) + buttonHtml("want", false) + '<p class="save-note" role="status"></p>';
    var chips = head.querySelector(".chips");
    if (chips) head.insertBefore(bar, chips);
    else head.appendChild(bar);
    var note = bar.querySelector(".save-note");
    bar.addEventListener("click", function (event) {
      var button = event.target.closest("[data-kind]");
      if (!button) return;
      toggle(button, slug, name, area, note);
    });
    me().then(function (payload) {
      if (!payload || !payload.user) return;
      return fetch("/api/account/saves", { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .then(function (body) {
          var saves = (body && body.saves) || [];
          config().then(function (cfg) {
            saves.forEach(function (save) {
              if (save.slug !== slug || save.site !== cfg.site) return;
              var button = bar.querySelector('[data-kind="' + save.kind + '"]');
              if (button) setPressed(button, true);
            });
          });
        });
    });
  }

  function buttonHtml(kind, on) {
    var label = kind === "favorite" ? "Favorite" : "Want to try";
    return '<button type="button" class="save-button" data-kind="' + kind + '" aria-pressed="' + (on ? "true" : "false") + '">' + icon(kind, on) + "<span>" + label + "</span></button>";
  }

  function setPressed(button, on) {
    var kind = button.getAttribute("data-kind");
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.innerHTML = icon(kind, on) + "<span>" + (kind === "favorite" ? "Favorite" : "Want to try") + "</span>";
  }

  function toggle(button, slug, name, area, note) {
    var kind = button.getAttribute("data-kind");
    var next = button.getAttribute("aria-pressed") !== "true";
    me().then(function (payload) {
      if (!payload || !payload.user) {
        location.href = signInHref();
        return;
      }
      setPressed(button, next);
      fetch("/api/account/saves", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slug, name: name, area: area, kind: kind, saved: next })
      }).then(function (response) {
        if (response.status === 401) {
          location.href = signInHref();
          return null;
        }
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      }).then(function (result) {
        if (!result) return;
        if (!result.ok) {
          setPressed(button, !next);
          note.textContent = (result.body && result.body.error) || "That place could not be saved.";
          return;
        }
        note.textContent = next ? "Saved." : "Removed.";
      }).catch(function () {
        setPressed(button, !next);
        note.textContent = "That place could not be saved.";
      });
    });
  }

  function queryParam(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  function continueSignIn(cfg, next) {
    if (!cfg || !cfg.accountsOrigin || !cfg.site) return false;
    var finish = new URL("/api/account/finish", location.origin);
    finish.searchParams.set("next", next || "/my-places/");
    var dest = new URL("/v1/continue", cfg.accountsOrigin);
    dest.searchParams.set("site", cfg.site);
    dest.searchParams.set("return", finish.toString());
    location.href = dest.toString();
    return true;
  }

  function mountSignIn(root) {
    var form = root.querySelector("[data-magic]");
    var status = root.querySelector(".account-status");
    var signed = root.querySelector("[data-signed]");
    if (queryParam("error") === "expired" && status) {
      status.textContent = "That link expired. Request a new one.";
    }
    var nextField = document.createElement("input");
    nextField.type = "hidden";
    nextField.name = "next";
    nextField.value = queryParam("next") || "/my-places/";
    if (form) form.appendChild(nextField);

    me().then(function (payload) {
      if (payload && payload.user) {
        if (form) form.hidden = true;
        if (signed) {
          signed.hidden = false;
          signed.textContent = "";
          var line = document.createElement("p");
          line.textContent = "You are signed in as " + payload.user.email + ".";
          var places = document.createElement("a");
          places.className = "button";
          places.href = "/my-places/";
          places.textContent = "My places";
          var out = document.createElement("button");
          out.type = "button";
          out.className = "button secondary";
          out.textContent = "Sign out";
          out.addEventListener("click", signOut);
          signed.appendChild(line);
          var row = document.createElement("p");
          row.className = "action-row";
          row.appendChild(places);
          row.appendChild(out);
          signed.appendChild(row);
        }
        return;
      }
      if (queryParam("need") === "1") return;
      config().then(function (cfg) {
        continueSignIn(cfg, nextField.value);
      });
    });

    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var email = form.email.value.trim();
      var marketing = form.marketing && form.marketing.checked === true;
      status.textContent = "";
      fetch("/api/account/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email, marketingOptIn: marketing, next: nextField.value })
      }).then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      }).then(function (result) {
        if (!result.ok) {
          status.textContent = (result.body && result.body.error) || "The sign-in email could not be sent.";
          return;
        }
        status.textContent = "Check your email for a sign-in link. It expires in 20 minutes.";
        if (result.body && result.body.previewUrl) {
          var preview = document.createElement("a");
          preview.href = result.body.previewUrl;
          preview.textContent = "Open the sign-in link";
          status.appendChild(document.createTextNode(" "));
          status.appendChild(preview);
        }
      }).catch(function () {
        status.textContent = "The sign-in email could not be sent.";
      });
    });
  }

  function signOut() {
    fetch("/api/account/logout", { method: "POST", credentials: "same-origin" }).then(function () {
      refreshMe();
      location.href = "/account/?need=1";
    });
  }

  function mountPlaces(root) {
    var list = root.querySelector("[data-places]");
    var status = root.querySelector("[data-places-status]");
    var kind = "favorite";
    var siteFilter = "all";
    var saves = [];
    var current = "";

    function render() {
      var shown = saves.filter(function (save) {
        if (save.kind !== kind) return false;
        if (siteFilter !== "all" && save.site !== siteFilter) return false;
        return true;
      });
      list.textContent = "";
      if (!shown.length) {
        var empty = document.createElement("p");
        empty.className = "place-empty";
        empty.textContent = emptyCopy(kind, siteFilter);
        list.appendChild(empty);
        return;
      }
      shown.forEach(function (save) {
        list.appendChild(card(save, current));
      });
    }

    function card(save, current) {
      var article = document.createElement("article");
      article.className = "place-card";
      var label = document.createElement("p");
      label.className = "place-site";
      label.textContent = LABELS[save.site] || save.site;
      var heading = document.createElement("h2");
      var link = document.createElement("a");
      link.href = placeHref(save, current);
      link.textContent = save.name;
      heading.appendChild(link);
      article.appendChild(label);
      article.appendChild(heading);
      if (save.area) {
        var area = document.createElement("p");
        area.className = "place-area";
        area.textContent = save.area;
        article.appendChild(area);
      }
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button secondary place-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        fetch("/api/account/saves", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: save.slug, name: save.name, area: save.area, kind: save.kind, site: save.site, saved: false })
        }).then(function (response) {
          if (!response.ok) throw new Error("remove");
          saves = saves.filter(function (item) {
            return !(item.site === save.site && item.slug === save.slug && item.kind === save.kind);
          });
          render();
        }).catch(function () {
          status.textContent = "That place could not be removed.";
        });
      });
      article.appendChild(remove);
      return article;
    }

    root.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        kind = tab.getAttribute("data-tab");
        root.querySelectorAll("[data-tab]").forEach(function (item) {
          item.setAttribute("aria-selected", item === tab ? "true" : "false");
        });
        render();
      });
    });
    root.querySelectorAll("[data-site-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        siteFilter = button.getAttribute("data-site-filter");
        root.querySelectorAll("[data-site-filter]").forEach(function (item) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        render();
      });
    });

    Promise.all([me(), config()]).then(function (parts) {
      var payload = parts[0];
      var cfg = parts[1];
      current = (cfg && cfg.site) || "";
      if (!payload || !payload.user) {
        if (queryParam("need") !== "1" && continueSignIn(cfg, "/my-places/")) return;
        showSignedOut();
        return;
      }
      fetch("/api/account/saves", { credentials: "same-origin" })
        .then(function (response) { return response.json(); })
        .then(function (body) {
          saves = (body && body.saves) || [];
          render();
        })
        .catch(function () {
          status.textContent = "Your places could not be loaded.";
        });
    });

    function showSignedOut() {
      status.textContent = "";
      var prompt = document.createElement("p");
      var link = document.createElement("a");
      link.className = "button";
      link.href = "/account/?need=1&next=" + encodeURIComponent("/my-places/");
      link.textContent = "Sign in";
      prompt.appendChild(link);
      list.textContent = "";
      list.appendChild(prompt);
    }
  }

  function emptyCopy(kind, site) {
    var noun = kind === "favorite" ? "favorites" : "places to try";
    if (site === "30a") return "No " + noun + " from 30A yet.";
    if (site === "destin") return "No " + noun + " from Destin yet.";
    if (kind === "favorite") return "No favorites yet. Use the heart on a listing to save one.";
    return "Nothing saved to try yet. Use Want to try on a listing.";
  }

  function boot() {
    refreshNav();
    mountSaves();
    var page = document.querySelector("[data-account-page]");
    if (!page) return;
    if (page.getAttribute("data-account-page") === "signin") mountSignIn(page);
    if (page.getAttribute("data-account-page") === "places") mountPlaces(page);
  }

  document.addEventListener("site-header-ready", refreshNav);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
