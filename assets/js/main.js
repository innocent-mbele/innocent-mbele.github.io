/* Navigation, project filters and screenshot viewer. No dependencies. */
(function () {
  "use strict";
  document.documentElement.classList.remove("no-js");

  // Mobile navigation
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  // Project filters (categories come from the generated buttons, not a hard-coded list)
  var filterBar = document.querySelector("[data-filters]");
  if (filterBar) {
    var buttons = filterBar.querySelectorAll("[data-filter]");
    var cards = document.querySelectorAll("[data-category]");
    var counter = document.querySelector("[data-result-count]");
    var apply = function (cat, updateUrl) {
      var valid = false;
      buttons.forEach(function (b) {
        var on = b.getAttribute("data-filter") === cat;
        if (on) valid = true;
        b.setAttribute("aria-pressed", String(on));
      });
      if (!valid) { cat = "all"; buttons[0].setAttribute("aria-pressed", "true"); }
      var shown = 0;
      cards.forEach(function (c) {
        var show = cat === "all" || c.getAttribute("data-category") === cat;
        c.hidden = !show;
        if (show) shown++;
      });
      if (counter) counter.textContent = shown + (shown === 1 ? " project" : " projects");
      if (updateUrl) {
        var url = new URL(window.location.href);
        if (cat === "all") url.searchParams.delete("category"); else url.searchParams.set("category", cat);
        history.replaceState(null, "", url);
      }
    };
    buttons.forEach(function (b) {
      b.addEventListener("click", function () { apply(b.getAttribute("data-filter"), true); });
    });
    apply(new URLSearchParams(window.location.search).get("category") || "all", false);
  }

  // Screenshot lightbox
  var dialog = document.getElementById("lightbox");
  var triggers = Array.prototype.slice.call(document.querySelectorAll("[data-full]"));
  if (dialog && triggers.length && typeof dialog.showModal === "function") {
    var img = dialog.querySelector("img");
    var cap = dialog.querySelector("p");
    var idx = 0;
    var show = function (i) {
      idx = (i + triggers.length) % triggers.length;
      var t = triggers[idx];
      img.src = t.getAttribute("data-full");
      img.alt = t.querySelector("img").alt;
      cap.textContent = "Screenshot " + (idx + 1) + " of " + triggers.length + ". " + t.getAttribute("data-caption");
    };
    triggers.forEach(function (t, i) {
      t.addEventListener("click", function () { show(i); dialog.showModal(); });
    });
    dialog.querySelector(".lb-close").addEventListener("click", function () { dialog.close(); });
    dialog.querySelector(".lb-prev").addEventListener("click", function () { show(idx - 1); });
    dialog.querySelector(".lb-next").addEventListener("click", function () { show(idx + 1); });
    dialog.addEventListener("click", function (e) { if (e.target === dialog || e.target.classList.contains("lightbox-inner")) dialog.close(); });
    dialog.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") show(idx - 1);
      if (e.key === "ArrowRight") show(idx + 1);
    });
    dialog.addEventListener("close", function () { if (triggers[idx]) triggers[idx].focus(); });
  } else {
    // No <dialog> support: open the full image directly.
    triggers.forEach(function (t) {
      t.addEventListener("click", function () { window.open(t.getAttribute("data-full"), "_blank", "noopener"); });
    });
  }

})();
