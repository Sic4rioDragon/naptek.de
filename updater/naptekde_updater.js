// naptekde_updater.js — Helix seeding (fast); chapters run will refine later
import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const { TWITCH_CLIENT_ID: CID, TWITCH_CLIENT_SECRET: CS, CHANNEL_LOGIN='nap_tek' } = process.env;
const ROOT = path.resolve(process.cwd(), '..');
const P = (...x) => path.join(ROOT, ...x);
const J = o => JSON.stringify(o, null, 2);
const read = async f => { try { return JSON.parse(await fs.readFile(P(...f),'utf8')); } catch { return null; } };
const write = async (f,o) => { await fs.mkdir(path.dirname(P(...f)),{recursive:true}); await fs.writeFile(P(...f),J(o)); };
const toMin = (s='0m') => { const g=r=>+(s.match(r)?.[1]||0); return g(/(\d+)h/)*60 + g(/(\d+)m/) + Math.ceil(g(/(\d+)s/)/60); };

async function appToken(){
  const r = await fetch('https://id.twitch.tv/oauth2/token',{ method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:CID,client_secret:CS,grant_type:'client_credentials'})
  });
  const j = await r.json(); if(!j.access_token) throw new Error('No app token'); return j.access_token;
}
const H = t => ({ 'Client-ID': CID, Authorization: `Bearer ${t}` });
const api = (t,p,q='') => fetch(`https://api.twitch.tv/helix/${p}${q?`?${q}`:''}`, {headers:H(t)}).then(r=>r.json());

const titleGuess = t => {
  const s = (t||'').toLowerCase();
  if (s.includes('hunt')) return 'Hunt: Showdown';
  if (s.includes('just chatting') || s.includes('gumo')) return 'Just Chatting';
  if (s.includes('battlefield') || s.includes('bf6')) return 'Battlefield 2042';
  if (s.includes('cs2') || s.includes('counter-strike')) return 'Counter-Strike 2';
  return 'Uncategorized';
};
(async ()=>{
  console.log('[upd] start');
  const t = await appToken();

  const u = await api(t,'users','login='+encodeURIComponent(CHANNEL_LOGIN));
  const user = u.data?.[0]; if(!user){ console.log('[upd] channel not found'); return; }
  console.log('[upd] channel:', user.display_name, 'id:', user.id);

  const clips = (await api(t,'clips',`broadcaster_id=${user.id}&first=20`)).data || [];
  await write(['data','clips.json'], clips.map(c=>({ id:c.id, title:c.title, creator_name:c.creator_name, created_at:c.created_at })));
  console.log('[upd] clips:', clips.length);

  const vods = (await api(t,'videos',`user_id=${user.id}&type=archive&first=50&sort=time`)).data || [];
  console.log('[upd] vods returned:', vods.length);

  const prev = await read(['data','streams.json']) || [];
  const add  = vods.map(v=>{
    const minutes = toMin(v.duration||'0m');
    const start = new Date(v.created_at||v.published_at).toISOString();
    const end   = new Date(new Date(start).getTime()+minutes*60000).toISOString();
    return { id:v.id, title:v.title, game_id:v.game_id||null, created_at:start, ended_at:end, duration_minutes:minutes };
  });
  const streams = [...add, ...prev].filter((s,i,a)=>a.findIndex(x=>x.id===s.id)===i);
  await write(['data','streams.json'], streams);
  console.log('[upd] appended to streams.json:', add.length);

  // lightweight per-VOD category rollup (accurate when game_id present; else titleGuess)
  const by = new Map();
  for(const v of vods){
    const name = v.game_id ? `id:${v.game_id}` : titleGuess(v.title);
    const row = by.get(name) || { name, sessions:0, minutes_total:0, platform:'PC', last_streamed:v.created_at };
    row.sessions += 1; row.minutes_total += toMin(v.duration||'0m'); row.last_streamed = v.created_at;
    by.set(name,row);
  }
  // resolve ids → names
  const ids = [...by.keys()].filter(k=>k.startsWith('id:')).map(k=>k.slice(3));
  if (ids.length){
    const r = await api(t,'games', ids.map(x=>'id='+x).join('&')); const map = {}; (r.data||[]).forEach(g=>map[g.id]=g.name);
    for (const k of [...by.keys()]){
      if (!k.startsWith('id:')) continue;
      const id = k.slice(3), row = by.get(k); by.delete(k);
      row.name = map[id] || `Game ${id}`; by.set(row.name, row);
    }
  }
  const games = [...by.values()].sort((a,b)=>b.minutes_total-a.minutes_total);
  await write(['data','games.json'], games);
  const total = games.reduce((n,g)=>n+g.minutes_total,0);
  await write(['data','stream_stats.json'], { minutes_total_overall: total, games_total: games.length, updated_at: new Date().toISOString(), source:'helix' });

  console.log('[upd] games total:', games.length);
  console.log('[upd] minutes_total_overall:', total);
  console.log('[upd] done ✔');
})().catch(e=>{ console.error('[upd] ERROR', e); process.exit(1); });
