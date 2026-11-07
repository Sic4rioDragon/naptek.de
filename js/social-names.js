// A single naming theme is chosen each time the homepage loads.
// Visible joke labels change; accessible platform names and URLs stay correct.
(() => {
  const themes = [
    { discord: "DiscNap", youtube: "YouNap", tiktok: "TikNap", instagram: "InstaNap" },
    { discord: "Napcord", youtube: "NapTube", tiktok: "NapTok", instagram: "Napgram" },
    { discord: "Discotek", youtube: "YouTek", tiktok: "TikTek", instagram: "InstaTek" }
  ];
  const theme = themes[Math.floor(Math.random() * themes.length)];
  const apply = () => {
    document.querySelectorAll("[data-social-name]").forEach(el => {
      const platform = el.dataset.socialName;
      if (Object.prototype.hasOwnProperty.call(theme, platform)) {
        el.textContent = theme[platform];
      }
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
})();
