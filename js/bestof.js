(async () => {
  const wrap = document.getElementById('clips');
  try{
    const r = await fetch('../data/clips.json',{cache:'no-store'});
    const d = await r.json();
    if(!Array.isArray(d) || !d.length){ wrap.textContent='Noch keine Clips.'; return; }
    wrap.innerHTML = d.map(c => `
      <article class="clip">
        <iframe src="https://clips.twitch.tv/embed?clip=${c.id}&parent=naptek.de&parent=www.naptek.de&autoplay=false"></iframe>
        <h3>${c.title || 'Clip'}</h3>
        <p class="small">${c.creator_name || ''} • ${new Date(c.created_at).toLocaleDateString('de-CH')}</p>
      </article>`).join('');
  }catch{ wrap.textContent='Clip-Daten nicht verfügbar.'; }
})();
