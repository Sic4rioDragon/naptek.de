(() => {
  "use strict";
  const base = "/data/twitch/";
  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n).toLocaleString("de-DE");
  const hours = (seconds) => (Number(seconds || 0) / 3600).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " h";
  const signed = (n) => n == null || !Number.isFinite(Number(n)) ? "–" : (Number(n) > 0 ? "+" : "") + num(n);
  const date = (value) => {
    const d = new Date(value || "");
    return Number.isNaN(d.getTime()) ? "–" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  };
  const fetchJson = async (path) => {
    const r = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + ": HTTP " + r.status);
    return r.json();
  };
  const load = (file) => fetchJson(base + file + ".json").catch(() => null);
  const text = (id, value) => { if ($(id)) $(id).textContent = value; };
  const el = (tag, cls, value) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  };
  const clear = (id) => { const n = $(id); if (n) n.replaceChildren(); return n; };
  function safeTwitchUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && (u.hostname === "www.twitch.tv" || u.hostname === "twitch.tv") ? u.href : null;
    } catch { return null; }
  }
  function viewChart(id, config) {
    if (typeof window.Chart !== "function") return false;
    const canvas = $(id);
    if (!canvas) return false;
    new window.Chart(canvas, config);
    return true;
  }
  function gameRows(games) {
    const wrap = clear("game-list");
    if (!games.length) { wrap.append(el("p", "empty-state", "Noch keine Spiele-Daten vorhanden.")); return; }
    const max = Math.max(1, Number(games[0].total_seconds_observed || 0));
    for (const g of games.slice(0, 12)) {
      const row = el("div", "game-progress");
      const head = el("div", "game-progress-header");
      head.append(el("strong", "", g.game_name || "Ohne Kategorie"));
      head.append(el("span", "muted", hours(g.total_seconds_observed) + " · " + num(g.streams_observed || 0) + " Streams"));
      const track = el("div", "progress-track");
      const bar = el("div", "progress-fill");
      bar.style.width = Math.min(100, Math.max(0, Number(g.total_seconds_observed || 0) / max * 100)) + "%";
      track.append(bar);
      row.append(head, track);
      wrap.append(row);
    }
  }
  function streamRows(sessions) {
    const wrap = clear("stream-list");
    const ordered = [...sessions].sort((a, b) => Date.parse(b.started_at || 0) - Date.parse(a.started_at || 0));
    if (!ordered.length) { wrap.append(el("p", "empty-state", "Noch keine Streams erfasst.")); return; }
    for (const s of ordered.slice(0, 8)) {
      const item = el("article", "content-card stream-row");
      const left = el("div", "stream-row-main");
      left.append(el("strong", "", s.title_last_seen || s.title_first_seen || "Stream"));
      const names = [...new Set((s.categories || []).map(c => c.game_name).filter(Boolean))];
      left.append(el("p", "muted", date(s.started_at) + (names.length ? " · " + names.join(" / ") : "")));
      const right = el("div", "stream-row-side");
      const span = Date.parse(s.ended_at || s.last_seen_at || "") - Date.parse(s.started_at || "");
      right.append(el("strong", "", Number.isFinite(span) && span > 0 ? hours(span / 1000) : "–"));
      right.append(el("small", "muted", "Peak beobachtet: " + num(s.peak_viewers_observed || 0)));
      item.append(left, right);
      wrap.append(item);
    }
  }
  function videos(videos) {
    const wrap = clear("vod-list");
    const filtered = videos.filter(v => safeTwitchUrl(v.url)).slice(0, 6);
    if (!filtered.length) { wrap.append(el("p", "empty-state", "Aktuell keine VODs verfügbar.")); return; }
    for (const v of filtered) {
      const a = el("a", "content-card mini-media-card");
      a.href = safeTwitchUrl(v.url);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.append(el("strong", "", v.title || "Twitch-VOD"));
      a.append(el("span", "muted", date(v.published_at || v.created_at) + " · " + (v.duration || "Dauer unbekannt")));
      wrap.append(a);
    }
  }
  function legacy(oldStats, oldGames) {
    if (oldStats && Number.isFinite(Number(oldStats.minutes_total_overall))) {
      text("legacy-total", "Separat erfasst: " + hours(Number(oldStats.minutes_total_overall) * 60 + Number(oldStats.seconds_remainder_overall || 0)) + " · Stand Oktober 2025");
    } else text("legacy-total", "Keine ältere Gesamtzeit vorhanden.");
    const wrap = clear("legacy-games");
    if (!Array.isArray(oldGames) || !oldGames.length) { wrap.append(el("p", "muted", "Keine älteren Game-Daten vorhanden.")); return; }
    for (const game of oldGames) {
      wrap.append(el("span", "legacy-chip", (game.name || "Unbekannt") + " · " + hours(Number(game.minutes_total || 0) * 60 + Number(game.seconds_remainder || 0))));
    }
  }
  async function init() {
    text("year", String(new Date().getFullYear()));
    const [summary, followHistory, gameStats, streamHistory, vodData, health, oldStats, oldGames] = await Promise.all([
      load("summary"), load("follower-history"), load("game-stats"), load("stream-history"),
      load("videos"), load("health"), fetchJson("/data/stream_stats.json").catch(() => null),
      fetchJson("/data/games.json").catch(() => null)
    ]);
    if (summary) {
      text("stat-followers", num(summary.followers_total ?? 0));
      text("stat-net", signed(summary.follower_net_change_7d));
      text("stat-gained", summary.followers_gained_7d == null ? "–" : num(summary.followers_gained_7d));
      text("stat-sessions", num(summary.tracked_streams ?? 0));
      text("stat-hours", hours(summary.tracked_stream_seconds ?? 0));
      text("stat-vods", num(summary.available_vods ?? 0));
      if (summary.next_follower_milestone != null) {
        text("stat-milestone", "Noch " + num(summary.followers_to_milestone || 0) + " bis " + num(summary.next_follower_milestone));
      }
      const stamp = summary._meta?.updated_at;
      text("stats-update", "Twitch-Datenstand: " + (stamp ? new Date(stamp).toLocaleString("de-DE") : "unbekannt"));
      const old = !stamp || Date.now() - Date.parse(stamp) > 2 * 60 * 60 * 1000;
      if (old || health?.ok === false) {
        const warning = $("stats-warning");
        warning.hidden = false;
        warning.textContent = "Einige Twitch-Daten sind möglicherweise veraltet oder vorübergehend nicht verfügbar.";
      }
    } else {
      text("stats-update", "Aktuelle Twitch-Stats nicht verfügbar.");
      $("stats-warning").hidden = false;
      text("stats-warning", "Die gespeicherten historischen Daten werden angezeigt, soweit verfügbar.");
    }
    const points = Array.isArray(followHistory?.days) ? followHistory.days : [];
    if (points.length >= 2 && viewChart("followers-chart", {
      type: "line",
      data: { labels: points.map(p => p.date), datasets: [{ label: "Follower", data: points.map(p => p.total), borderColor: "#8dcff4", backgroundColor: "rgba(141,207,244,.08)", fill: true, tension: .18, pointRadius: points.length > 20 ? 0 : 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 7 } }, y: { ticks: { precision: 0 } } } }
    })) {
      text("followers-fallback", "Tageswerte: " + points.length);
    } else {
      text("followers-fallback", points.length ? "Follower-Verlauf: " + num(points[0].total) + " → " + num(points.at(-1).total) + " (" + points.length + " Tage)" : "Noch kein Follower-Verlauf.");
      $("followers-chart").hidden = true;
    }
    const games = Array.isArray(gameStats?.games) ? gameStats.games : [];
    gameRows(games);
    if (games.length) viewChart("games-chart", {
      type: "bar",
      data: { labels: games.slice(0, 7).map(g => g.game_name), datasets: [{ label: "Beobachtete Stunden", data: games.slice(0, 7).map(g => Number(g.total_seconds_observed || 0) / 3600), backgroundColor: "#8dcff4" }] },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });
    if (!games.length || typeof window.Chart !== "function") $("games-chart").hidden = true;
    streamRows(Array.isArray(streamHistory?.sessions) ? streamHistory.sessions : []);
    videos(Array.isArray(vodData?.videos) ? vodData.videos : []);
    legacy(oldStats, oldGames);
  }
  init().catch(err => {
    console.warn("[naptek stats]", err);
    text("stats-update", "Stats konnten nicht geladen werden.");
  });
})();
