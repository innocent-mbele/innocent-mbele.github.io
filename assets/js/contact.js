/* Contact form: validation, spam checks and submission to Web3Forms.
   The Web3Forms access key is a public form identifier (it only lets the form
   deliver to the inbox it was issued for), so it is safe in client code.
   It is set in the form's data-access-key attribute (see data/site.json). */
(function () {
  "use strict";
  var form = document.getElementById("contact-form");
  if (!form) return;

  var ENDPOINT = "https://api.web3forms.com/submit";
  var MIN_FILL_MS = 3000;
  var loadedAt = Date.now();
  var statusBox = document.getElementById("form-status");
  var submitBtn = form.querySelector("button[type=submit]");
  var label = submitBtn.querySelector(".label");
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var rules = {
    name: function (v) { return v.trim().length >= 2 ? "" : "Please enter your full name."; },
    email: function (v) {
      if (!v.trim()) return "Please enter your email address.";
      return EMAIL_RE.test(v.trim()) ? "" : "Please enter a valid email address, e.g. name@example.com.";
    },
    subject: function (v) { return v.trim().length >= 3 ? "" : "Please enter a subject."; },
    message: function (v) { return v.trim().length >= 10 ? "" : "Please enter a message (at least 10 characters)."; }
  };

  function setError(field, msg) {
    var input = form.elements[field];
    var err = document.getElementById(field + "-error");
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (err) err.textContent = msg;
    return !msg;
  }

  function validate() {
    var first = null;
    Object.keys(rules).forEach(function (f) {
      var ok = setError(f, rules[f](form.elements[f].value));
      if (!ok && !first) first = form.elements[f];
    });
    if (first) first.focus();
    return !first;
  }

  function status(kind, msg) {
    statusBox.className = "form-status show " + kind;
    statusBox.textContent = msg;
  }

  Object.keys(rules).forEach(function (f) {
    form.elements[f].addEventListener("blur", function () {
      if (form.elements[f].value) setError(f, rules[f](form.elements[f].value));
    });
    form.elements[f].addEventListener("input", function () {
      if (form.elements[f].getAttribute("aria-invalid") === "true") setError(f, rules[f](form.elements[f].value));
    });
  });

  function busy(on) {
    submitBtn.disabled = on;
    form.classList.toggle("is-sending", on);
    label.textContent = on ? "Sending…" : "Send message";
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) {
      status("error", "Please correct the highlighted fields.");
      return;
    }
    // Spam checks: hidden honeypot must stay empty and humans take a few seconds to fill the form.
    if (form.elements.botcheck.checked || form.elements.website.value) {
      status("success", "Thank you. Your message has been sent.");
      form.reset();
      return;
    }
    if (Date.now() - loadedAt < MIN_FILL_MS) {
      status("error", "That was very fast. Please wait a moment and send again.");
      return;
    }
    var key = form.getAttribute("data-access-key");
    if (!key) {
      status("error", "The contact form is not connected to a delivery service yet, so your message was not sent. Please try again later.");
      return;
    }

    var payload = {
      access_key: key,
      subject: "Portfolio contact: " + form.elements.subject.value.trim(),
      from_name: "innocent-mbele.github.io",
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      replyto: form.elements.email.value.trim(),
      message: form.elements.message.value.trim(),
      botcheck: false
    };

    busy(true);
    status("pending", "Sending your message…");
    var controller = "AbortController" in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 15000);

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.success) {
          status("success", "Thank you, your message has been sent. I will reply to the email address you provided.");
          form.reset();
          Object.keys(rules).forEach(function (f) { setError(f, ""); });
          loadedAt = Date.now();
        } else {
          status("error", "Sorry, the message could not be sent" + (r.data && r.data.message ? " (" + r.data.message + ")" : "") + ". Please try again in a few minutes.");
        }
      })
      .catch(function (err) {
        status("error", err && err.name === "AbortError"
          ? "The request timed out. Please check your connection and try again."
          : "Network error: the message could not be sent. Please check your connection and try again.");
      })
      .then(function () { clearTimeout(timer); busy(false); });
  });
})();
