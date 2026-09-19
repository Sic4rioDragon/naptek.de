(() => {
  const BASE = "/data/twitch";

  async function load(name) {
    const res = await fetch(`${BASE}/${name}.json?v=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`${name}.json -> HTTP ${res.status}`);
    return res.json();
  }

  function setText(selector, value) {
    if (value === null || value === undefined) return;
    document.querySelectorAll(selector).forEach((el) => {
      el.textContent = String(value);
    });
  }

  function setHidden(selector, hidden) {
    document.querySelectorAll(selector).forEach((el) => {
      el.hidden = hidden;
    });
  }

  function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("de-DE") : "–";
  }

  function formatUpdated(value) {
    if (!value) return "–";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "–";
    return date.toLocaleString("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function formatUptime(startedAt) {
    const start = Date.parse(startedAt || "");
    if (!Number.isFinite(start)) return null;
    const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours ? `${hours}h ${mins}m live` : `${mins}m live`;
  }

  async function hydrate() {
    try {
      const [current, summary, health] = await Promise.all([
        load("current"),
        load("summary").catch(() => null),
        load("health").catch(() => null),
      ]);

      const live = Boolean(current.live);
      const stream = current.stream;
      const channel = current.channel;
      const updatedAt = current._meta?.updated_at || summary?._meta?.updated_at || null;

      setText("[data-twitch-followers]", `${formatNumber(current.followers_total)} Follower`);
      setText("[data-twitch-bio]", current.broadcaster?.description || "");
      setText("[data-twitch-status]", live ? "LIVE" : "Offline");
      setText("[data-twitch-title]", stream?.title || channel?.title || "Kein Streamtitel verfügbar");
      setText("[data-twitch-game]", stream?.game_name || channel?.game_name || "");
      setText("[data-twitch-viewers]", live ? `${formatNumber(stream?.viewer_count || 0)} Zuschauer` : "");
      setText("[data-twitch-uptime]", live ? (formatUptime(stream?.started_at) || "") : "");
      setText("[data-twitch-updated]", formatUpdated(updatedAt));

      setHidden("[data-twitch-live-only]", !live);
      setHidden("[data-twitch-offline-only]", live);

      document.documentElement.dataset.twitchLive = live ? "true" : "false";
      document.documentElement.dataset.twitchDataHealthy = health?.ok === false ? "false" : "true";

      document.querySelectorAll("[data-twitch-status-card]").forEach((el) => {
        el.classList.toggle("is-live", live);
        el.classList.toggle("is-offline", !live);
      });

      window.dispatchEvent(new CustomEvent("naptek:twitchdata", {
        detail: { current, summary, health },
      }));
    } catch (err) {
      console.warn("[naptek Twitch data]", err);
      document.documentElement.dataset.twitchDataHealthy = "false";
      setText("[data-twitch-followers]", "Twitch-Daten nicht verfügbar");
      setText("[data-twitch-status]", "Status unbekannt");
      setText("[data-twitch-updated]", "–");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, { once: true });
  } else {
    hydrate();
  }
})();
