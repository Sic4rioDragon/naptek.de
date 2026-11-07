(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const make = (tag, cls, value) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (value != null) n.textContent = String(value);
    return n;
  };
  function render(id, items, formatter) {
    const target = $(id);
    target.replaceChildren();
    if (!Array.isArray(items) || !items.length) {
      target.append(make("p", "muted", "Aktuell keine freigegebenen Einträge."));
      return;
    }
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const value = formatter(item);
      if (value) target.append(make("span", "supporter-pill", value));
    }
    if (!target.childElementCount) target.append(make("p", "muted", "Aktuell keine freigegebenen Einträge."));
  }
  async function init() {
    $("year").textContent = String(new Date().getFullYear());
    const response = await fetch("/data/supporters.json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("Supporter-Daten: HTTP " + response.status);
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Ungültige Supporter-Daten");
    render("vips", data.vips, v => v.display_name || v.name || "");
    render("subs", data.subscribers || data.subs, s => {
      const name = s.display_name || s.name;
      return name ? name + (s.tier ? " · Tier " + s.tier : "") : "";
    });
    render("bits", data.bits, b => {
      const name = b.display_name || b.name;
      return name ? name + (b.score != null ? " · " + Number(b.score).toLocaleString("de-DE") + " Bits" : "") : "";
    });
    render("donos", data.donations, d => {
      const name = d.display_name || d.name;
      return name ? name + (d.amount != null ? " · " + d.amount + " " + (d.currency || "") : "") : "";
    });
    const timestamp = data.updated_at ? new Date(data.updated_at) : null;
    $("support-data-status").textContent =
      "Lokale, freigegebene Einträge" +
      (timestamp && Number.isFinite(timestamp.getTime()) ? " · Datenstand: " + timestamp.toLocaleDateString("de-DE") : "") +
      " · keine automatische Live-Synchronisierung";
  }
  init().catch(err => {
    console.warn("[naptek danke]", err);
    for (const id of ["vips", "subs", "bits", "donos"]) $(id).textContent = "Daten gerade nicht verfügbar.";
    $("support-data-status").textContent = "Community-Daten momentan nicht erreichbar.";
  });
})();
