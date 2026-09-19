(() => {
  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function lines(value) {
    return escapeHtml(value).replaceAll("\n", "<br>");
  }

  async function loadAbout() {
    const response = await fetch(`/data/twitch/about.json?v=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`about.json -> HTTP ${response.status}`);
    return response.json();
  }

  function renderPairs(target, rows) {
    const el = $(target);
    if (!el) return;
    el.innerHTML = (rows || []).map((row) => `
      <div class="detail-row">
        <dt>${escapeHtml(row.label)}</dt>
        <dd>${lines(row.value)}</dd>
      </div>
    `).join("");
  }

  async function hydrate() {
    try {
      const about = await loadAbout();

      const bio = $("[data-about-bio]");
      if (bio) bio.textContent = about.bio || "";

      const schedule = $("[data-about-schedule]");
      if (schedule) {
        schedule.innerHTML = (about.usual_schedule || []).map((row) => `
          <li><strong>${escapeHtml(row.day)}:</strong> ${escapeHtml(row.content)}</li>
        `).join("");
      }

      const faq = $("[data-about-faq]");
      if (faq) {
        faq.innerHTML = (about.faq || []).map((item) => `
          <article class="faq-item">
            <h3>${escapeHtml(item.question)}</h3>
            <p>${escapeHtml(item.answer)}</p>
          </article>
        `).join("");
      }

      renderPairs("[data-about-specs]", about.pc_specs);
      renderPairs("[data-about-character]", about.character);

      const motto = $("[data-about-motto]");
      if (motto) motto.textContent = about.support?.motto || "";

      const support = $("[data-about-support]");
      if (support) support.textContent = about.support?.text || "";

      const donate = $("[data-about-donate-link]");
      if (donate && about.support?.donation_url) donate.href = about.support.donation_url;

      const captured = $("[data-about-captured]");
      if (captured) captured.textContent = about._meta?.captured_at || "";
    } catch (err) {
      console.warn("[naptek about]", err);
      document.documentElement.dataset.aboutDataHealthy = "false";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, { once: true });
  } else {
    hydrate();
  }
})();
