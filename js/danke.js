// Public Mode: reads data/supporters.json (can switch to Worker/API later)
(async () => {
  const $ = s => document.querySelector(s);
  const j = (arr, cls='') => (arr||[]).map(x=>(
    `<span class="pill${cls}">${x.display_name}${x.streak?` • ${x.streak}×`:''}</span>`
  )).join('') || '—';

  async function load(u){ try{
    const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw 0; return r.json();
  }catch{ return null; } }

  const d = await load('../data/supporters.json');
  if(!d){ ['#vips','#vipsPast','#subs','#subsPast','#bits','#donos']
    .forEach(s=>$(s).textContent='Noch keine Daten.'); return; }

  // VIPs
  $('#vips').innerHTML = j(d.vips);
  $('#vipsPast').innerHTML = j(d.vips_past);

  // Subs by tier (active)
  const T={1:[],2:[],3:[]}; (d.subscribers||[]).forEach(s=>T[s.tier]?.push(s));
  $('#subs').innerHTML = [1,2,3].map(t=>{
    return `<div><strong>Tier ${t}</strong><div>${j(T[t],` tier${t}`)}</div></div>`;
  }).join('');

  // Past subs (flat list)
  $('#subsPast').innerHTML = j(d.subscribers_past);

  // Bits & donations
  $('#bits').innerHTML  = (d.bits||[]).map((b,i)=>
    `<span class="pill">#${i+1} ${b.display_name} • ${b.score} Bits</span>`).join('')||'—';
  $('#donos').innerHTML = (d.donations||[]).map(u=>
    `<span class="pill">${u.display_name} • ${u.amount} ${u.currency}</span>`).join('')||'—';
})();
