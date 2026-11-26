/* Visitor counts for the admin page.
   Sends a tiny anonymous message to the admin service: one "visit" per browser tab session,
   the project page being viewed, or a project's GitHub link clicked on the home page.
   No cookies, no IP address and no personal details are sent or kept.
   Open the site once with ?notrack=1 to stop counting your own visits in that browser
   (?notrack=0 turns counting back on). */
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="stats-endpoint"]');
  if (!meta || !meta.content) return;
  var endpoint = meta.content;

  try {
    var q = new URLSearchParams(location.search).get("notrack");
    if (q === "1") localStorage.setItem("notrack", "1");
    if (q === "0") localStorage.removeItem("notrack");
    if (localStorage.getItem("notrack") === "1") return;
  } catch (e) { /* storage blocked: count normally */ }
  if (navigator.webdriver) return;

  function send(data) {
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(endpoint, { method: "POST", body: body, mode: "no-cors", keepalive: true, credentials: "omit" }); } catch (e) { /* ignore */ }
  }

  var visit = true;
  try {
    if (sessionStorage.getItem("visited") === "1") visit = false;
    else sessionStorage.setItem("visited", "1");
  } catch (e) { /* storage blocked: count this page as a visit */ }

  var project = document.querySelector('meta[name="stats-project"]');
  var data = {};
  if (visit) data.visit = true;
  if (project && project.content) data.project = project.content;
  if (data.visit || data.project) send(data);

  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a[data-stats-project]") : null;
    if (a) send({ project: a.getAttribute("data-stats-project"), via: "github" });
  });
})();
