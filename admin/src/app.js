"use strict";
(function () {
  var API = "/inno/api";
  var SITE_URL = "https://innocent-mbele.github.io";
  var state = { head: null, site: null, projects: null, original: "", uploads: {}, selected: 0 };

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "text") el.textContent = v;
      else if (k === "on") Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
      else if (k === "value") el.value = v == null ? "" : v;
      else if (k === "checked") el.checked = !!v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      (Array.isArray(c) ? c : [c]).forEach(function (x) { if (x != null) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
    }
    return el;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "item"; }
  function rand() { return Math.random().toString(36).slice(2, 7); }
  function imgUrl(path) { return state.uploads[path] ? state.uploads[path].url : SITE_URL + "/" + path; }
  function linesToList(t) { return String(t).split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  function showStatus(kind, text) {
    var s = $("status");
    s.hidden = !text;
    s.className = "status" + (kind ? " " + kind : "");
    s.textContent = text || "";
  }

  function api(method, path, body) {
    return fetch(API + path, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { showSignIn(); throw new Error("Your session has ended. Please sign in again."); }
        if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
        return data;
      });
    });
  }

  function changed() {
    var now = JSON.stringify([state.site, state.projects]);
    var n = Object.keys(state.uploads).filter(function (k) { return !/-thumb\.webp$/.test(k); }).length;
    var dirty = now !== state.original || n > 0;
    $("publish").disabled = !dirty;
    $("changes").textContent = dirty ? ("Unpublished changes" + (n ? " (" + n + " new image" + (n === 1 ? "" : "s") + ")" : "")) : "No changes yet";
  }

  function field(label, value, onInput, opts) {
    opts = opts || {};
    var input = opts.multiline
      ? h("textarea", { value: value, rows: opts.rows || 4, maxlength: opts.max || 4000 })
      : h("input", { type: opts.type || "text", value: value, maxlength: opts.max || 300, placeholder: opts.placeholder || false });
    input.addEventListener("input", function () { onInput(input.value); changed(); });
    return h("label", {}, label, opts.hint ? h("span", { class: "hint", text: opts.hint }) : null, input);
  }

  function select(label, value, options, onChange) {
    var s = h("select", {});
    options.forEach(function (o) { s.appendChild(h("option", { value: o[0], text: o[1] })); });
    s.value = value;
    s.addEventListener("change", function () { onChange(s.value); changed(); });
    return h("label", {}, label, s);
  }

  // ---------------------------------------------------------------- images
  function canvasToWebp(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob || blob.type !== "image/webp") return reject(new Error("This browser cannot make WebP images. Please use Chrome or Edge."));
        resolve(blob);
      }, "image/webp", 0.84);
    });
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.readAsDataURL(blob);
    });
  }
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("That file is not an image I can read.")); };
      img.src = URL.createObjectURL(file);
    });
  }
  function scaled(img, maxW) {
    var w = Math.min(maxW, img.naturalWidth || img.width);
    var hgt = Math.round((img.naturalHeight || img.height) * w / (img.naturalWidth || img.width));
    var c = document.createElement("canvas");
    c.width = w; c.height = hgt;
    c.getContext("2d").drawImage(img, 0, 0, w, hgt);
    return c;
  }
  function addUpload(path, blob) {
    return blobToBase64(blob).then(function (b64) {
      state.uploads[path] = { base64: b64, url: URL.createObjectURL(blob) };
    });
  }

  function uploadScreenshot(project, file) {
    return loadImage(file).then(function (img) {
      var full = scaled(img, 1600), thumb = scaled(img, 720);
      var name = String(project.screenshots.length + 1).padStart(2, "0") + "-" + slugify(file.name.replace(/\.[^.]+$/, "")) + "-" + rand();
      var dir = "assets/images/projects/" + slugify(project.slug);
      var shot = {
        title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), caption: "", alt: "",
        src: dir + "/" + name + ".webp", thumb: dir + "/" + name + "-thumb.webp",
        width: full.width, height: full.height, thumb_width: thumb.width, thumb_height: thumb.height
      };
      return Promise.all([canvasToWebp(full), canvasToWebp(thumb)]).then(function (b) {
        return Promise.all([addUpload(shot.src, b[0]), addUpload(shot.thumb, b[1])]);
      }).then(function () { project.screenshots.push(shot); });
    });
  }

  // ---------------------------------------------------------------- photo crop
  var SHAPES = { square: [1, 1], portrait: [4, 5], landscape: [4, 3] };
  function cropPhoto(file) {
    return loadImage(file).then(function (img) {
      return new Promise(function (resolve) {
        var dlg = $("crop"), canvas = $("crop-canvas"), ctx = canvas.getContext("2d");
        var shapeSel = $("crop-shape"), zoomIn = $("crop-zoom");
        var view = { x: 0, y: 0, zoom: 1 };
        shapeSel.value = state.site.profile_photo.shape || "square";
        zoomIn.value = 1;
        function frame() {
          var s = SHAPES[shapeSel.value];
          canvas.width = 480; canvas.height = Math.round(480 * s[1] / s[0]);
          return { w: canvas.width, h: canvas.height };
        }
        function base(f) { return Math.max(f.w / img.naturalWidth, f.h / img.naturalHeight); }
        function clamp(f) {
          var sc = base(f) * view.zoom, iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
          view.x = Math.min(0, Math.max(f.w - iw, view.x));
          view.y = Math.min(0, Math.max(f.h - ih, view.y));
        }
        function draw() {
          var f = frame(); clamp(f);
          var sc = base(f) * view.zoom;
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, f.w, f.h);
          ctx.drawImage(img, view.x, view.y, img.naturalWidth * sc, img.naturalHeight * sc);
        }
        function centre() {
          var f = frame(), sc = base(f) * view.zoom;
          view.x = (f.w - img.naturalWidth * sc) / 2; view.y = (f.h - img.naturalHeight * sc) / 2; draw();
        }
        var drag = null;
        canvas.onpointerdown = function (e) { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(e.pointerId); };
        canvas.onpointermove = function (e) {
          if (!drag) return;
          var k = canvas.width / canvas.getBoundingClientRect().width;
          view.x = drag.vx + (e.clientX - drag.x) * k; view.y = drag.vy + (e.clientY - drag.y) * k; draw();
        };
        canvas.onpointerup = function () { drag = null; };
        zoomIn.oninput = function () {
          var f = frame(), cx = f.w / 2, cy = f.h / 2, old = base(f) * view.zoom;
          view.zoom = Number(zoomIn.value);
          var now = base(f) * view.zoom;
          view.x = cx - (cx - view.x) * now / old; view.y = cy - (cy - view.y) * now / old; draw();
        };
        shapeSel.onchange = centre;
        $("crop-cancel").onclick = function () { dlg.close(); resolve(null); };
        $("crop-ok").onclick = function () {
          var f = frame(), out = document.createElement("canvas"), k = 720 / f.w, sc = base(f) * view.zoom;
          out.width = 720; out.height = Math.round(f.h * k);
          var o = out.getContext("2d");
          o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height);
          o.drawImage(img, view.x * k, view.y * k, img.naturalWidth * sc * k, img.naturalHeight * sc * k);
          dlg.close();
          resolve({ canvas: out, shape: shapeSel.value });
        };
        dlg.showModal();
        centre();
      });
    });
  }

  // ---------------------------------------------------------------- profile tab
  var SIZES = { small: 170, medium: 220, large: 280 };
  var RATIO = { square: "1 / 1", portrait: "4 / 5", landscape: "4 / 3" };
  var FOCUS = { center: "50% 50%", top: "50% 0%", bottom: "50% 100%", left: "0% 50%", right: "100% 50%" };

  function renderProfile() {
    var s = state.site, ph = s.profile_photo;
    var tab = $("tab-profile"); tab.innerHTML = "";
    var preview = h("div", { class: "photo-preview" });
    function updatePreview() {
      preview.innerHTML = "";
      preview.style.width = SIZES[ph.size] + "px";
      preview.style.aspectRatio = RATIO[ph.shape];
      if (ph.src) preview.appendChild(h("img", { src: imgUrl(ph.src), alt: "", style: "object-position:" + FOCUS[ph.focus] }));
    }
    var file = h("input", { type: "file", accept: "image/*", hidden: true });
    file.addEventListener("change", function () {
      if (!file.files[0]) return;
      cropPhoto(file.files[0]).then(function (r) {
        if (!r) return;
        return canvasToWebp(r.canvas).then(function (blob) {
          var path = "assets/images/profile/profile-" + rand() + ".webp";
          return addUpload(path, blob).then(function () {
            ph.src = path; ph.shape = r.shape; renderProfile(); changed();
          });
        });
      }).catch(function (e) { showStatus("err", e.message); });
      file.value = "";
    });
    updatePreview();
    tab.append(
      h("h2", { text: "Profile" }),
      h("div", { class: "grid2" },
        field("Name", s.name, function (v) { s.name = v; }, { max: 80 }),
        field("Role line", s.role, function (v) { s.role = v; }, { max: 120 })),
      field("Tagline", s.tagline, function (v) { s.tagline = v; }, { max: 160 }),
      field("Introduction", s.intro, function (v) { s.intro = v; }, { multiline: true, max: 1200, rows: 5, hint: "Shown at the top of the home page. Write it the way you would say it." }),
      field("Footer text", s.footer, function (v) { s.footer = v; }, { max: 400 }),
      h("h3", { text: "Profile photo" }),
      h("div", { class: "photo-row" },
        preview,
        h("div", { style: "flex:1;min-width:240px" },
          h("p", {}, h("button", { type: "button", class: "btn", on: { click: function () { file.click(); } } }, "Upload a new photo"),
            h("span", { class: "hint", text: "You can crop it after choosing. It is saved as WebP, which also removes hidden data such as location." })),
          file,
          select("Shape", ph.shape, [["square", "Square"], ["portrait", "Portrait 4:5"], ["landscape", "Landscape 4:3"]], function (v) { ph.shape = v; updatePreview(); }),
          select("Size on the page", ph.size, [["small", "Small"], ["medium", "Medium"], ["large", "Large"]], function (v) { ph.size = v; updatePreview(); }),
          select("Which part to keep in view", ph.focus, [["center", "Centre"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]], function (v) { ph.focus = v; updatePreview(); }),
          field("Photo description (for screen readers)", ph.alt, function (v) { ph.alt = v; }, { max: 300 }),
          ph.src ? h("button", { type: "button", class: "btn small danger", on: { click: function () { if (confirm("Remove the photo from the site?")) { ph.src = ""; renderProfile(); changed(); } } } }, "Remove photo") : null))
    );
  }

  // ---------------------------------------------------------------- links tab
  function rowTable(items, columns, makeNew, rerender, max) {
    var t = h("table", { class: "rows" },
      h("thead", {}, h("tr", {}, columns.map(function (c) { return h("th", { text: c[1] }); }), h("th", { text: "" }))));
    var body = h("tbody");
    items.forEach(function (it, i) {
      body.appendChild(h("tr", {},
        columns.map(function (c) {
          var inp = h("input", { type: "text", value: it[c[0]] || "", maxlength: c[2] || 300, "aria-label": c[1] });
          inp.addEventListener("input", function () { if (inp.value || c[3]) it[c[0]] = inp.value; else delete it[c[0]]; changed(); });
          return h("td", {}, inp);
        }),
        h("td", { style: "white-space:nowrap" },
          h("button", { type: "button", class: "btn small", title: "Move up", on: { click: function () { move(items, i, -1); rerender(); changed(); } } }, "↑"),
          h("button", { type: "button", class: "btn small", title: "Move down", on: { click: function () { move(items, i, 1); rerender(); changed(); } } }, "↓"),
          h("button", { type: "button", class: "btn small danger", on: { click: function () { items.splice(i, 1); rerender(); changed(); } } }, "Remove"))));
    });
    t.appendChild(body);
    return h("div", {}, t, items.length < max ? h("button", { type: "button", class: "btn", on: { click: function () { items.push(makeNew()); rerender(); changed(); } } }, "Add") : null);
  }

  function renderLinks() {
    var s = state.site, tab = $("tab-links"); tab.innerHTML = "";
    tab.append(
      h("h2", { text: "Links" }),
      h("p", { class: "hint", text: "Shown under your introduction and in the footer, for example GitHub and LinkedIn. Addresses must start with https://" }),
      rowTable(s.links, [["label", "Label", 40, true], ["url", "Address", 500, true]], function () { return { label: "", url: "https://" }; }, renderLinks, 12),
      h("h2", { style: "margin-top:24px", text: "Repositories" }),
      h("p", { class: "hint", text: "The table under your projects. Use the exact GitHub repository name. Leave the address empty to use github.com/" + s.github_user + "/<name>." }),
      rowTable(s.repositories, [["name", "Repository name", 100, true], ["description", "What is in it", 300, true], ["url", "Address (optional)", 500, false]], function () { return { name: "", description: "" }; }, renderLinks, 40)
    );
  }

  // ---------------------------------------------------------------- projects tab
  function renderProjects() {
    var d = state.projects, tab = $("tab-projects"); tab.innerHTML = "";
    if (state.selected >= d.projects.length) state.selected = d.projects.length - 1;
    var cats = d.categories.map(function (c) { return [c.id, c.label]; });
    var listEl = h("ul", { class: "proj-list" });
    d.projects.forEach(function (p, i) {
      var cat = d.categories.filter(function (c) { return c.id === p.category; })[0];
      listEl.appendChild(h("li", { class: i === state.selected ? "on" : "" },
        h("button", { type: "button", class: "link", style: "text-align:left;margin:0", on: { click: function () { state.selected = i; renderProjects(); } } },
          p.title || "(untitled)", " ", h("span", { class: "meta", text: (cat ? cat.label : "") + (p.featured ? " · on home page" : "") })),
        h("span", { style: "white-space:nowrap" },
          h("button", { type: "button", class: "btn small", title: "Move up", on: { click: function () { move(d.projects, i, -1); state.selected = Math.max(0, i - 1); renderProjects(); changed(); } } }, "↑"),
          h("button", { type: "button", class: "btn small", title: "Move down", on: { click: function () { move(d.projects, i, 1); state.selected = Math.min(d.projects.length - 1, i + 1); renderProjects(); changed(); } } }, "↓"))));
    });
    var addBtn = h("button", { type: "button", class: "btn", on: { click: function () {
      d.projects.push({ slug: "new-project-" + rand(), repo: (state.site.repositories[0] || {}).name || "", folder: "", title: "New project", category: d.categories[0].id,
        featured: false, status: "Completed", summary: "", overview: "", objectives: [], technologies: [], implementation: [], verification: [], screenshots: [] });
      state.selected = d.projects.length - 1; renderProjects(); changed();
    } } }, "Add a project");

    tab.append(h("h2", { text: "Projects" }), h("p", { class: "hint", text: "The order here is the order on the site. Projects marked for the home page appear first in the list's order." }), listEl, addBtn);
    var p = d.projects[state.selected];
    if (!p) return;
    var shotsList = h("ul", { class: "shots" });
    p.screenshots.forEach(function (s, k) {
      shotsList.appendChild(h("li", {},
        h("img", { src: imgUrl(s.thumb), alt: "" }),
        field("Title", s.title, function (v) { s.title = v; }, { max: 200 }),
        field("Caption", s.caption, function (v) { s.caption = v; }, { max: 1000 }),
        field("Description for screen readers", s.alt, function (v) { s.alt = v; }, { max: 300 }),
        h("div", { class: "shot-tools" },
          h("button", { type: "button", class: "btn small", on: { click: function () { move(p.screenshots, k, -1); renderProjects(); changed(); } } }, "←"),
          h("button", { type: "button", class: "btn small", on: { click: function () { move(p.screenshots, k, 1); renderProjects(); changed(); } } }, "→"),
          h("button", { type: "button", class: "btn small", on: { click: function () { p.cover = k + 1; renderProjects(); changed(); } } }, (p.cover || p.screenshots.length) === k + 1 ? "Card picture ✓" : "Use as card picture"),
          h("button", { type: "button", class: "btn small danger", on: { click: function () {
            if (!confirm("Remove this screenshot?")) return;
            delete state.uploads[s.src]; delete state.uploads[s.thumb];
            p.screenshots.splice(k, 1);
            if (p.cover && p.cover > p.screenshots.length) delete p.cover;
            renderProjects(); changed();
          } } }, "Remove"))));
    });
    var shotInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
    shotInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(shotInput.files);
      shotInput.value = "";
      showStatus("", "Preparing " + files.length + " image(s)…");
      files.reduce(function (pr, f) { return pr.then(function () { return uploadScreenshot(p, f); }); }, Promise.resolve())
        .then(function () { showStatus("", ""); renderProjects(); changed(); })
        .catch(function (e) { showStatus("err", e.message); renderProjects(); changed(); });
    });

    tab.append(
      h("h3", { text: "Edit: " + (p.title || "(untitled)") }),
      h("div", { class: "grid2" },
        field("Title", p.title, function (v) { p.title = v; }, { max: 120 }),
        field("Web address", p.slug, function (v) { p.slug = v; }, { max: 80, hint: "Lowercase letters, numbers and dashes. The page is /projects/<this>/" })),
      h("div", { class: "grid3" },
        select("Area", p.category, cats, function (v) { p.category = v; }),
        field("Repository name", p.repo, function (v) { p.repo = v; }, { max: 100 }),
        field("Folder in the repository", p.folder, function (v) { p.folder = v; }, { max: 200, hint: "Leave empty if the project is the whole repository." })),
      field("Status", p.status, function (v) { p.status = v; }, { max: 200, hint: "For example: Completed. Or: In progress. Part one is done." }),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: p.featured, on: { change: function (e) { p.featured = e.target.checked; changed(); } } }), "Show on the home page as a selected project"),
      field("Short summary (on the project card)", p.summary, function (v) { p.summary = v; }, { multiline: true, max: 600, rows: 3 }),
      field("Overview", p.overview, function (v) { p.overview = v; }, { multiline: true, max: 4000, rows: 6 }),
      field("What I set out to do (one per line)", (p.objectives || []).join("\n"), function (v) { p.objectives = linesToList(v); }, { multiline: true, max: 18000 }),
      field("What I did (one step per line)", (p.implementation || []).join("\n"), function (v) { p.implementation = linesToList(v); }, { multiline: true, max: 24000, rows: 6 }),
      field("How I tested it (one per line)", (p.verification || []).join("\n"), function (v) { p.verification = linesToList(v); }, { multiline: true, max: 18000 }),
      field("Problems I hit (one per line, optional)", (p.results || []).join("\n"), function (v) { p.results = linesToList(v); }, { multiline: true, max: 12000, rows: 3 }),
      field("Tools and services (separate with commas)", (p.technologies || []).join(", "), function (v) { p.technologies = v.split(",").map(function (x) { return x.trim(); }).filter(Boolean); }, { max: 2400 }),
      h("div", { class: "grid2" },
        field("Repository address (optional)", p.repo_url, function (v) { if (v) p.repo_url = v; else delete p.repo_url; }, { max: 500, hint: "Only if the project is not in your account." }),
        field("Video link (optional)", p.video, function (v) { if (v) p.video = v; else delete p.video; }, { max: 500 })),
      h("h3", { text: "Screenshots" }),
      h("p", { class: "warn", text: "Before uploading, paint over subscription IDs and check that no password, key, token or employer information is visible." }),
      shotsList,
      h("p", {}, h("button", { type: "button", class: "btn", on: { click: function () { shotInput.click(); } } }, "Add screenshots"), shotInput),
      h("div", { class: "row-right" },
        h("button", { type: "button", class: "btn danger", on: { click: function () {
          if (d.projects.length < 2) return alert("Keep at least one project.");
          if (!confirm("Delete the project \"" + p.title + "\" from the website? Its repository on GitHub is not touched.")) return;
          p.screenshots.forEach(function (s) { delete state.uploads[s.src]; delete state.uploads[s.thumb]; });
          d.projects.splice(state.selected, 1); state.selected = Math.max(0, state.selected - 1); renderProjects(); changed();
        } } }, "Delete this project"))
    );
  }

  // ---------------------------------------------------------------- settings tab
  function renderSettings() {
    var s = state.site, d = state.projects, tab = $("tab-settings"); tab.innerHTML = "";
    tab.append(
      h("h2", { text: "Project areas" }),
      h("p", { class: "hint", text: "These become the filter tabs. The id is used in links, so keep it short (a-z, 0-9 and -). An area with no projects is hidden on the site." }),
      rowTable(d.categories, [["id", "Id", 60, true], ["label", "Name", 60, true]], function () { return { id: "new-area-" + rand(), label: "New area" }; }, renderSettings, 20),
      h("h2", { style: "margin-top:24px", text: "Site settings" }),
      field("Contact form key (Web3Forms)", s.web3forms_access_key, function (v) { s.web3forms_access_key = v.trim(); }, { max: 64, hint: "From web3forms.com. Until this is set, the contact form tells visitors it is not connected." }),
      field("Admin address", s.admin_url, function (v) { s.admin_url = v.trim(); }, { max: 500, hint: "Where innocent-mbele.github.io/inno sends you, for example https://inno-admin.yourname.workers.dev/inno" }),
      field("Site address", s.base_url, function (v) { s.base_url = v.trim(); }, { max: 500 }),
      field("GitHub user name", s.github_user, function (v) { s.github_user = v.trim(); }, { max: 60 })
    );
  }

  // ---------------------------------------------------------------- tabs, load, publish
  function renderAll() { renderProfile(); renderLinks(); renderProjects(); renderSettings(); changed(); }

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tabs button").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      ["profile", "links", "projects", "settings"].forEach(function (t) { $("tab-" + t).hidden = t !== b.getAttribute("data-tab"); });
    });
  });

  function showSignIn() { $("app").hidden = true; $("who").hidden = true; $("signin").hidden = false; }

  function load() {
    return api("GET", "/content").then(function (c) {
      state.head = c.head; state.site = c.site; state.projects = c.projects; state.uploads = {};
      state.site.profile_photo = state.site.profile_photo || { src: "", alt: "", shape: "square", size: "medium", focus: "center" };
      state.site.links = state.site.links || []; state.site.repositories = state.site.repositories || [];
      state.original = JSON.stringify([state.site, state.projects]);
      renderAll();
    });
  }

  $("publish").addEventListener("click", function () {
    var btn = $("publish");
    btn.disabled = true;
    showStatus("", "Publishing…");
    var images = Object.keys(state.uploads).map(function (p) { return { path: p, base64: state.uploads[p].base64 }; });
    api("POST", "/publish", { head: state.head, site: state.site, projects: state.projects, images: images, message: $("note").value })
      .then(function (r) {
        $("note").value = "";
        var msg = r.unchanged ? "Nothing to publish." : "Published. The site rebuilds itself and updates in about two minutes.";
        return load().then(function () { showStatus("ok", msg + (r.url ? " Commit: " + r.url : "")); });
      })
      .catch(function (e) { showStatus("err", e.message); changed(); });
  });

  $("signout").addEventListener("click", function () {
    if (!$("publish").disabled && !confirm("You have changes that are not published. Sign out anyway?")) return;
    fetch("/inno/auth/logout", { method: "POST", credentials: "same-origin" }).then(showSignIn);
  });

  window.addEventListener("beforeunload", function (e) { if (!$("publish").disabled) { e.preventDefault(); e.returnValue = ""; } });

  api("GET", "/session").then(function (u) {
    SITE_URL = u.site || SITE_URL;
    $("who-name").textContent = u.name || u.email || "Signed in";
    $("who").hidden = false; $("signin").hidden = true; $("app").hidden = false;
    return load();
  }).catch(function (e) { if ($("app").hidden) showSignIn(); else showStatus("err", e.message); });
})();
