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

  var savedState = null;
  var savesPromise = null;
  var listingNote = null;

  function putSave(payload) {
    return fetch("/api/account/saves", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (response.status === 401) {
        location.href = signInHref();
        return null;
      }
      return response.json().then(function (body) {
        return { ok: response.ok, body: body };
      });
    });
  }

  function kindLabel(kind) {
    return kind === "favorite" ? "Favorite" : "Want to try";
  }

  function buttonHtml(kind, on) {
    var label = kindLabel(kind);
    return '<button type="button" class="save-button" data-kind="' + kind + '" aria-pressed="' + (on ? "true" : "false") + '">' + icon(kind, on) + "<span>" + label + "</span></button>";
  }

  function setPressed(button, on) {
    var kind = button.getAttribute("data-kind");
    var label = kindLabel(kind);
    var bar = button.closest(".save-bar");
    var name = bar ? bar.getAttribute("data-name") || "" : "";
    button.setAttribute("aria-pressed", on ? "true" : "false");
    if (name) button.setAttribute("aria-label", label + " " + name);
    else button.removeAttribute("aria-label");
    button.innerHTML = icon(kind, on) + "<span>" + label + "</span>";
  }

  function createBar(slug, name, area, compact) {
    var bar = document.createElement("div");
    bar.className = compact ? "save-bar save-bar-compact" : "save-bar";
    bar.setAttribute("data-slug", slug);
    bar.setAttribute("data-name", name);
    bar.setAttribute("data-area", area);
    bar.innerHTML = buttonHtml("favorite", false) + buttonHtml("want", false) + '<p class="save-note" role="status"></p>';
    var buttons = bar.querySelectorAll(".save-button");
    for (var i = 0; i < buttons.length; i++) setPressed(buttons[i], false);
    return bar;
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
    var bar = createBar(slug, name, area, false);
    var panel = document.createElement("div");
    panel.className = "personal-note";
    panel.hidden = true;
    panel.innerHTML = '<label class="personal-note-label"><span>Your note</span><textarea maxlength="280" rows="3" placeholder="Add a personal note..."></textarea></label><div class="note-actions"><button type="button" class="button" data-note-save>Save note</button><button type="button" class="button secondary" data-note-clear>Clear</button></div><p class="personal-note-hint">Only you can see this. It also shows on My places. About 280 characters.</p><p class="personal-note-status" role="status" aria-live="polite"></p>';
    var chips = head.querySelector(".chips");
    if (chips) head.insertBefore(bar, chips);
    else head.appendChild(bar);
    bar.insertAdjacentElement("afterend", panel);
    listingNote = {
      slug: slug,
      name: name,
      area: area,
      panel: panel,
      field: panel.querySelector("textarea"),
      status: panel.querySelector(".personal-note-status"),
      stored: ""
    };
    panel.querySelector("[data-note-save]").addEventListener("click", function () {
      writeListingNote(listingNote.field.value, false);
    });
    panel.querySelector("[data-note-clear]").addEventListener("click", function () {
      listingNote.field.value = "";
      writeListingNote("", true);
    });
  }

  function noteForSlug(state, slug) {
    var text = "";
    var on = false;
    if (!state || !state.saves) return { on: false, text: "" };
    for (var i = 0; i < state.saves.length; i++) {
      var save = state.saves[i];
      if (save.slug !== slug || save.site !== state.site) continue;
      on = true;
      if (save.kind === "favorite" && save.note) text = save.note;
      else if (!text && save.note) text = save.note;
    }
    return { on: on, text: text };
  }

  function syncListingNote(state) {
    if (!listingNote) return;
    if (!state || !state.user) {
      listingNote.panel.hidden = true;
      return;
    }
    var found = noteForSlug(state, listingNote.slug);
    listingNote.panel.hidden = !found.on;
    if (!found.on) {
      listingNote.field.value = "";
      listingNote.stored = "";
      listingNote.status.textContent = "";
      return;
    }
    if (listingNote.field.value === listingNote.stored) {
      listingNote.stored = found.text || "";
      listingNote.field.value = listingNote.stored;
    }
  }

  function writeListingNote(text, clearing) {
    if (!listingNote) return;
    ensureSaves().then(function (state) {
      if (!state || !state.user) return;
      var kinds = [];
      for (var i = 0; i < state.saves.length; i++) {
        var save = state.saves[i];
        if (save.slug !== listingNote.slug || save.site !== state.site) continue;
        kinds.push(save.kind);
      }
      if (!kinds.length) return;
      if (text.length > 280) {
        listingNote.status.textContent = "Keep the note under 280 characters.";
        return;
      }
      listingNote.status.textContent = "";
      var buttons = listingNote.panel.querySelectorAll("button");
      for (var b = 0; b < buttons.length; b++) buttons[b].disabled = true;
      Promise.all(kinds.map(function (kind) {
        return putSave({
          slug: listingNote.slug,
          name: listingNote.name,
          area: listingNote.area,
          kind: kind,
          saved: true,
          note: text
        });
      })).then(function (results) {
        for (var n = 0; n < buttons.length; n++) buttons[n].disabled = false;
        if (results.some(function (result) { return !result; })) return;
        var failed = null;
        for (var r = 0; r < results.length; r++) {
          if (!results[r].ok) failed = results[r];
        }
        if (failed) {
          listingNote.field.value = listingNote.stored;
          listingNote.status.textContent = (failed.body && failed.body.error) || "That note could not be saved.";
          return;
        }
        var savedNote = results[0].body && typeof results[0].body.note === "string" ? results[0].body.note : text.trim();
        for (var s = 0; s < state.saves.length; s++) {
          if (state.saves[s].slug === listingNote.slug && state.saves[s].site === state.site) {
            state.saves[s].note = savedNote;
          }
        }
        listingNote.stored = savedNote;
        listingNote.field.value = savedNote;
        listingNote.status.textContent = clearing || !savedNote ? "Note cleared." : "Note saved.";
      }).catch(function () {
        for (var n = 0; n < buttons.length; n++) buttons[n].disabled = false;
        listingNote.field.value = listingNote.stored;
        listingNote.status.textContent = "That note could not be saved.";
      });
    });
  }

  function mountCardSaves(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var slots = scope.querySelectorAll(".save-slot");
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      if (slot.querySelector(".save-bar")) continue;
      var slug = slot.getAttribute("data-slug") || "";
      if (!slug) continue;
      slot.appendChild(createBar(slug, slot.getAttribute("data-name") || "", slot.getAttribute("data-area") || "", true));
    }
  }

  function ensureSaves() {
    if (savedState) return Promise.resolve(savedState);
    if (!savesPromise) {
      savesPromise = me().then(function (payload) {
        if (!payload || !payload.user) return { user: false, saves: [], site: "" };
        return Promise.all([
          fetch("/api/account/saves", { credentials: "same-origin" }).then(function (response) { return response.json(); }),
          config()
        ]).then(function (parts) {
          var body = parts[0];
          var cfg = parts[1];
          return {
            user: true,
            saves: (body && body.saves) || [],
            site: (cfg && cfg.site) || ""
          };
        });
      }).then(function (state) {
        if (!savedState) savedState = state;
        return savedState;
      }).catch(function () {
        savesPromise = null;
        return { user: false, saves: [], site: "" };
      });
    }
    return savesPromise;
  }

  function rememberSave(slug, kind, name, area, saved, note) {
    ensureSaves().then(function (state) {
      if (!state || !state.user) return;
      var sibling = "";
      var next = [];
      for (var i = 0; i < state.saves.length; i++) {
        var save = state.saves[i];
        if (save.slug === slug && save.kind === kind && save.site === state.site) continue;
        if (save.slug === slug && save.site === state.site && save.note) sibling = save.note;
        next.push(save);
      }
      if (saved) {
        var text = typeof note === "string" ? note : sibling;
        next.push({ slug: slug, name: name, area: area, kind: kind, site: state.site, note: text || "" });
      }
      state.saves = next;
    });
  }

  function paintSaves() {
    if (!document.querySelector(".save-bar[data-slug]")) return;
    ensureSaves().then(function (state) {
      if (!state || !state.user) return;
      var bars = document.querySelectorAll(".save-bar[data-slug]");
      for (var i = 0; i < bars.length; i++) {
        var bar = bars[i];
        var slug = bar.getAttribute("data-slug");
        var buttons = bar.querySelectorAll("[data-kind]");
        for (var j = 0; j < buttons.length; j++) {
          var button = buttons[j];
          var kind = button.getAttribute("data-kind");
          var on = false;
          for (var k = 0; k < state.saves.length; k++) {
            var save = state.saves[k];
            if (save.slug === slug && save.kind === kind && save.site === state.site) on = true;
          }
          setPressed(button, on);
        }
      }
      syncListingNote(state);
    });
  }

  function mountSaveControls(root) {
    mountSaves();
    mountCardSaves(root || document);
    paintSaves();
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
      putSave({ slug: slug, name: name, area: area, kind: kind, saved: next }).then(function (result) {
        if (!result) return;
        if (!result.ok) {
          setPressed(button, !next);
          if (note) note.textContent = (result.body && result.body.error) || "That place could not be saved.";
          return;
        }
        if (note) note.textContent = next ? "Saved." : "Removed.";
        var copied = next && result.body && typeof result.body.note === "string" ? result.body.note : undefined;
        rememberSave(slug, kind, name, area, next, copied);
        paintSaves();
      }).catch(function () {
        setPressed(button, !next);
        if (note) note.textContent = "That place could not be saved.";
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
      var coupons30a = Boolean(form.coupons30a && form.coupons30a.checked);
      var couponsDestin = Boolean(form.couponsDestin && form.couponsDestin.checked);
      status.textContent = "";
      fetch("/api/account/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email,
          coupons30a: coupons30a,
          couponsDestin: couponsDestin,
          marketingOptIn: coupons30a || couponsDestin,
          next: nextField.value
        })
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
      var noteWrap = document.createElement("div");
      noteWrap.className = "place-note";
      var noteLabel = document.createElement("p");
      noteLabel.className = "place-note-label";
      noteLabel.id = "note-label-" + save.site + "-" + save.kind + "-" + save.slug;
      noteLabel.textContent = "Your note";
      var view = document.createElement("p");
      view.className = "place-note-view";
      var empty = document.createElement("p");
      empty.className = "place-note-empty";
      empty.textContent = "Add a personal note...";
      var editor = document.createElement("textarea");
      editor.className = "place-note-input";
      editor.maxLength = 280;
      editor.rows = 3;
      editor.placeholder = "Add a personal note...";
      editor.setAttribute("aria-labelledby", noteLabel.id);
      var actions = document.createElement("div");
      actions.className = "note-actions";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "button secondary";
      var saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "button";
      saveBtn.textContent = "Save note";
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "button secondary";
      cancelBtn.textContent = "Cancel";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button secondary place-remove";
      remove.textContent = "Remove";
      var editing = false;

      function paint() {
        var text = save.note || "";
        var has = text.trim().length > 0;
        view.textContent = text;
        view.hidden = editing || !has;
        empty.hidden = editing || has;
        editor.hidden = !editing;
        if (!editing) editor.value = text;
        editBtn.hidden = editing;
        editBtn.textContent = has ? "Edit note" : "Add note";
        saveBtn.hidden = !editing;
        cancelBtn.hidden = !editing;
      }

      editBtn.addEventListener("click", function () {
        editing = true;
        editor.value = save.note || "";
        paint();
        editor.focus();
      });
      cancelBtn.addEventListener("click", function () {
        editing = false;
        status.textContent = "";
        paint();
      });
      saveBtn.addEventListener("click", function () {
        var text = editor.value;
        if (text.length > 280) {
          status.textContent = "Keep the note under 280 characters.";
          return;
        }
        status.textContent = "";
        saveBtn.disabled = true;
        putSave({
          slug: save.slug,
          name: save.name,
          area: save.area,
          kind: save.kind,
          site: save.site,
          note: text
        }).then(function (result) {
          saveBtn.disabled = false;
          if (!result) return;
          if (!result.ok) {
            status.textContent = (result.body && result.body.error) || "That note could not be saved.";
            return;
          }
          var nextNote = result.body && typeof result.body.note === "string" ? result.body.note : text.trim();
          saves.forEach(function (item) {
            if (item.site === save.site && item.slug === save.slug) item.note = nextNote;
          });
          status.textContent = nextNote ? "Note saved." : "Note cleared.";
          render();
        }).catch(function () {
          saveBtn.disabled = false;
          status.textContent = "That note could not be saved.";
        });
      });
      remove.addEventListener("click", function () {
        putSave({
          slug: save.slug,
          name: save.name,
          area: save.area,
          kind: save.kind,
          site: save.site,
          saved: false
        }).then(function (result) {
          if (!result || !result.ok) throw new Error("remove");
          saves = saves.filter(function (item) {
            return !(item.site === save.site && item.slug === save.slug && item.kind === save.kind);
          });
          status.textContent = "";
          render();
        }).catch(function () {
          status.textContent = "That place could not be removed.";
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      actions.appendChild(remove);
      noteWrap.appendChild(noteLabel);
      noteWrap.appendChild(view);
      noteWrap.appendChild(empty);
      noteWrap.appendChild(editor);
      noteWrap.appendChild(actions);
      paint();
      article.appendChild(noteWrap);
      return article;
    }

    root.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        kind = tab.getAttribute("data-tab");
        status.textContent = "";
        root.querySelectorAll("[data-tab]").forEach(function (item) {
          item.setAttribute("aria-selected", item === tab ? "true" : "false");
        });
        render();
      });
    });
    root.querySelectorAll("[data-site-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        siteFilter = button.getAttribute("data-site-filter");
        status.textContent = "";
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

  function mountCouponOptIn(root) {
    var block = root.querySelector("[data-coupon-optin]");
    var form = root.querySelector("[data-coupon-optin-form]");
    if (!block || !form) return;
    var status = form.querySelector("[data-coupon-status]");
    me().then(function (payload) {
      if (payload && payload.user) block.hidden = false;
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var coupons30a = Boolean(form.coupons30a && form.coupons30a.checked);
      var couponsDestin = Boolean(form.couponsDestin && form.couponsDestin.checked);
      if (status) status.textContent = "";
      if (!coupons30a && !couponsDestin) {
        if (status) status.textContent = "Choose Eating on 30A, Eating in Destin, or both.";
        return;
      }
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      fetch("/api/account/coupons", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coupons30a: coupons30a,
          couponsDestin: couponsDestin
        })
      }).then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body };
        }).catch(function () {
          return { ok: false, body: {} };
        });
      }).then(function (result) {
        if (!status) return;
        if (!result.ok) {
          status.textContent = (result.body && result.body.error) || "That could not be saved.";
          return;
        }
        status.textContent = "Saved. Coupons and updates will go to the email on your account.";
      }).catch(function () {
        if (status) status.textContent = "That could not be saved.";
      }).then(function () {
        if (button) button.disabled = false;
      });
    });
  }

  function emptyCopy(kind, site) {
    var noun = kind === "favorite" ? "favorites" : "places to try";
    if (site === "30a") return "No " + noun + " from 30A yet.";
    if (site === "destin") return "No " + noun + " from Destin yet.";
    if (kind === "favorite") return "No favorites yet. Use the heart on a restaurant to save one.";
    return "Nothing saved to try yet. Use Want to try on a restaurant.";
  }

  function onSaveClick(event) {
    var target = event.target;
    if (!target || !target.closest) target = target && target.parentElement;
    if (!target || !target.closest) return;
    var button = target.closest(".save-button");
    if (!button) return;
    var bar = button.closest(".save-bar");
    if (!bar) return;
    var slug = bar.getAttribute("data-slug") || "";
    if (!slug) return;
    toggle(button, slug, bar.getAttribute("data-name") || "", bar.getAttribute("data-area") || "", bar.querySelector(".save-note"));
  }

  function boot() {
    refreshNav();
    mountSaveControls(document);
    var page = document.querySelector("[data-account-page]");
    if (!page) return;
    if (page.getAttribute("data-account-page") === "signin") mountSignIn(page);
    if (page.getAttribute("data-account-page") === "places") {
      mountPlaces(page);
      mountCouponOptIn(page);
    }
  }

  document.addEventListener("click", onSaveClick);
  document.addEventListener("cards-mounted", function () {
    mountCardSaves(document);
    paintSaves();
  });
  document.addEventListener("site-header-ready", refreshNav);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
