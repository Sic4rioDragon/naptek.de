(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const saved = new Map();
  const BATCH = 12;
  let shown = BATCH;
  const get = async url => {
    const res = await fetch(url + "?v=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(url + ": " + res.status);
    return res.json();
  };
  const node = (tag, className, content) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (content !== undefined && content !== null) n.textContent = String(content);
    return n;
  };
  const validUrl = value => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && ["www.twitch.tv", "twitch.tv", "clips.twitch.tv"].includes(u.hostname) ? u.href : null;
    } catch { return null; }
  };
  const imageUrl = value => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && (u.hostname === "static-cdn.jtvnw.net" || u.hostname.endsWith(".jtvnw.net")) ? u.href : null;
    } catch { return null; }
  };
  const time = c => Date.parse(c.created_at || "") || 0;
  const date = value => {
    const d = new Date(value || "");
    return Number.isNaN(d.getTime()) ? "Unbekanntes Datum" : d.toLocaleDateString("de-DE");
  };
  function merge(c, source) {
    if (!c || typeof c.id !== "string" || !/^[\w-]{4,150}$/.test(c.id)) return;
    const old = saved.get(c.id) || {};
    saved.set(c.id, {
      ...old,
      ...Object.fromEntries(Object.entries(c).filter(([,v]) => v != null && v !== "")),
      source: source === "legacy" && old.source ? old.source : source
    });
  }
  function clipUrl(c) {
    return validUrl(c.url) || "https://clips.twitch.tv/" + encodeURIComponent(c.id);
  }
  function card(c) {
    const a = node("a", "clip-card clip-link");
    a.href = clipUrl(c);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", (c.title || "Clip") + " auf Twitch öffnen");
    const thumbnail = imageUrl(c.thumbnail_url);
    if (thumbnail) {
      const img = node("img", "clip-thumb");
      img.src = thumbnail;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      a.append(img);
    } else {
      a.append(node("div", "clip-placeholder", "Twitch-Clip"));
    }
    const info = node("div", "clip-card-body");
    info.append(node("h3", "", c.title || "Clip ansehen"));
    const details = [c.game_name, c.creator_name ? "von " + c.creator_name : null, date(c.created_at)].filter(Boolean);
    info.append(node("p", "clip-card-meta", details.join(" · ")));
    const foot = node("div", "clip-card-footer");
    if (Number.isFinite(Number(c.view_count)) && c.view_count != null) {
      foot.append(node("small", "muted", Number(c.view_count).toLocaleString("de-DE") + " Aufrufe"));
    } else foot.append(node("small", "muted", "Archivclip"));
    foot.append(node("strong", "", "Auf Twitch ansehen"));
    info.append(foot);
    a.append(info);
    return a;
  }
  function filtered() {
    const term = $("clip-search").value.trim().toLocaleLowerCase("de");
    const game = $("clip-game").value;
    const arr = [...saved.values()].filter(c => {
      const target = [c.title, c.creator_name, c.game_name].filter(Boolean).join(" ").toLocaleLowerCase("de");
      return (!term || target.includes(term)) && (!game || (c.game_name || "") === game);
    });
    const sort = $("clip-sort").value;
    arr.sort((a,b) => sort === "top"
      ? Number(b.view_count || 0) - Number(a.view_count || 0) || time(b) - time(a)
      : sort === "oldest" ? time(a) - time(b) : time(b) - time(a));
    return arr;
  }
  function render() {
    const wrap = $("clips");
    wrap.replaceChildren();
    const list = filtered();
    $("clip-count").textContent = list.length.toLocaleString("de-DE") + " Clips gefunden";
    if (!list.length) wrap.append(node("p", "empty-state", "Keine passenden Clips gefunden."));
    else for (const c of list.slice(0, shown)) wrap.append(card(c));
    $("clips-more-wrap").hidden = list.length <= shown;
  }
  async function init() {
    $("year").textContent = String(new Date().getFullYear());
    const results = await Promise.allSettled([
      get("/data/clips.json"),
      get("/data/twitch/clip-history.json"),
      get("/data/twitch/clips.json")
    ]);
    const legacy = results[0].status === "fulfilled" ? results[0].value : [];
    const history = results[1].status === "fulfilled" ? results[1].value : null;
    const current = results[2].status === "fulfilled" ? results[2].value : null;
    if (Array.isArray(legacy)) legacy.forEach(c => merge(c, "legacy"));
    if (Array.isArray(history?.clips)) history.clips.forEach(c => merge(c, "official"));
    if (Array.isArray(current?.top)) current.top.forEach(c => merge(c, "official"));
    if (Array.isArray(current?.recent)) current.recent.forEach(c => merge(c, "official"));
    const games = [...new Set([...saved.values()].map(c => c.game_name).filter(Boolean))].sort((a,b) => a.localeCompare(b, "de"));
    for (const game of games) {
      const opt = document.createElement("option");
      opt.value = game;
      opt.textContent = game;
      $("clip-game").append(opt);
    }
    for (const id of ["clip-search", "clip-game", "clip-sort"]) {
      $(id).addEventListener(id === "clip-search" ? "input" : "change", () => { shown = BATCH; render(); });
    }
    $("clips-more").addEventListener("click", () => { shown += BATCH; render(); });
    render();
    if (!saved.size && results.every(r => r.status === "rejected")) {
      $("clip-count").textContent = "Clip-Daten derzeit nicht erreichbar.";
    }
  }
  init().catch(err => {
    console.warn("[naptek bestof]", err);
    $("clips").replaceChildren(node("p", "empty-state", "Clips konnten nicht geladen werden."));
  });
})();
