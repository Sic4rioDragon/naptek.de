// npm i node-fetch@3 dotenv
import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

// .env: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, CHANNEL_LOGIN=nap_tek
const { TWITCH_CLIENT_ID: CID, TWITCH_CLIENT_SECRET: CS, CHANNEL_LOGIN='nap_tek' } = process.env;

// paths (script runs from /updater)
const ROOT = path.resolve(process.cwd(), '..');
const P = (...x) => path.join(ROOT, ...x);
const J = (o) => JSON.stringify(o, null, 2);
const read = async f => { try { return JSON.parse(await fs.readFile(P(...f),'utf8')); } catch { return null; } };
const write = async (f,o) => { await fs.mkdir(path.dirname(P(...f)),{recursive:true}); await fs.writeFile(P(...f),J(o)); };

// twitch durations like "2h13m5s" → minutes (round seconds up so short VODs count)
const toMin = (s='0m') => {
  const g = r => (s.match(r)?.[1] ? parseInt(s.match(r)[1],10) : 0);
  return g(/(\d+)h/)*60 + g(/(\d+)m/) + Math.ceil(g(/(\d+)s/)/60);
};

async function token(){
  const r = await fetch('https://id.twitch.tv/oauth2/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:CID,client_secret:CS,grant_type:'client_credentials'})
  });
  const j = await r.json(); if(!j.access_token) throw new Error('No app token');
  return j.access_token;
}
const H = t => ({ 'Client-ID': CID, Authorization: `Bearer ${t}` });
const api = (t,p,q='') => fetch(`https://api.twitch.tv/helix/${p}${q?`?${q}`:''}`, {headers:H(t)}).then(r=>r.json());

(async () => {
  console.log('[upd] start');
  const t = await token();
  const u = await api(t,'users','login='+encodeURIComponent(CHANNEL_LOGIN));
  const user = u.data?.[0]; if(!user){ console.log('[upd] channel not found'); return; }
  console.log('[upd] channel:', user.display_name, 'id:', user.id);

  // ---- CLIPS (recent 20) ----
  const clips = (await api(t,'clips',`broadcaster_id=${user.id}&first=20`)).data?.map(c=>({
    id:c.id, title:c.title, creator_name:c.creator_name, created_at:c.created_at
  })) || [];
  await write(['data','clips.json'], clips);
  console.log('[upd] clips:', clips.length);

  // ---- VODs (past broadcasts) ----
  const vods = (await api(t,'videos',`user_id=${user.id}&type=archive&first=50`)).data || [];
  console.log('[upd] vods returned:', vods.length);

  // state: on first run (no file) we seed from ALL vods
  const state = await read(['data','state.json']) || { seen_video_ids: [] };
  const seen  = new Set(state.seen_video_ids);
  const firstRun = state.seen_video_ids.length === 0;
  const fresh = firstRun ? vods : vods.filter(v => !seen.has(v.id));
  console.log('[upd] new vods:', fresh.length, firstRun ? '(first run: seeding)' : '');

  // ---- append streams.json (append-only) ----
  const oldLog = await read(['data','streams.json']) || [];
  const newLog = fresh.map(v=>({
    id: v.id,
    // we might not get a game_id for older VODs; mark name later when we can
    game_name: v.game_id ? null : 'Uncategorized',
    game_id: v.game_id || null,
    minutes: toMin(v.duration||'0m'),
    published_at: v.published_at
  }));
  await write(['data','streams.json'], oldLog.concat(newLog));
  console.log('[upd] appended to streams.json:', newLog.length);

  // ---- build per-game adds + overall total ----
  const addBy = {}; let addTotal = 0; let missingGame = 0;
  fresh.forEach(v => {
    const m=toMin(v.duration||'0m'); addTotal+=m;
    if (v.game_id) addBy[v.game_id]=(addBy[v.game_id]||0)+m;
    else missingGame += m;
  });

  // resolve names for touched game_ids
  let names = {};
  const touched = Object.keys(addBy);
  if(touched.length){
    const r = await api(t,'games', touched.map(id=>`id=${id}`).join('&'));
    (r.data||[]).forEach(g=>names[g.id]=g.name);
  }

  // merge into games.json (no delete). On first run, also include an "Uncategorized" bucket.
  const games = await read(['data','games.json']) || [];
  const byName = new Map(games.map(g=>[g.name,g]));

  touched.forEach(id => {
    const name = names[id] || `Game ${id}`;
    const row = byName.get(name) || { name, sessions:0, minutes_total:0, platform:'PC' };
    row.sessions      += fresh.filter(v => v.game_id === id).length;
    row.minutes_total += addBy[id];
    const last        = vods.find(v => v.game_id === id)?.published_at;
    row.last_streamed = last || row.last_streamed || null;
    byName.set(name,row);
  });

  if (firstRun && missingGame > 0) {
    const unk = byName.get('Uncategorized') || { name:'Uncategorized', sessions:0, minutes_total:0, platform:'PC' };
    unk.sessions      += fresh.filter(v => !v.game_id).length;
    unk.minutes_total += missingGame;
    unk.last_streamed  = vods.find(v => !v.game_id)?.published_at || unk.last_streamed || null;
    byName.set('Uncategorized', unk);
    console.log('[upd] note:', 'added Uncategorized =', missingGame, 'minutes');
  }

  const merged = [...byName.values()].sort((a,b)=>(b.minutes_total||0)-(a.minutes_total||0));
  await write(['data','games.json'], merged);
  console.log('[upd] games touched:', touched.length, 'total games:', merged.length);

  // overall totals (additive forever)
  const stats = await read(['data','stream_stats.json']) || { minutes_total_overall:0, updated_at:null };
  if (firstRun) {
    // initialize with ALL visible vod minutes
    stats.minutes_total_overall = vods.reduce((n,v)=>n+toMin(v.duration||'0m'),0);
  } else {
    stats.minutes_total_overall += addTotal;
  }
  stats.updated_at = new Date().toISOString();
  await write(['data','stream_stats.json'], stats);
  console.log('[upd] +minutes_total_overall:', firstRun ? stats.minutes_total_overall : addTotal, firstRun?'(seeded total)':'');

  // remember processed ids (cap list size)
  const nextSeen = Array.from(new Set([...state.seen_video_ids, ...fresh.map(v=>v.id)])).slice(-500);
  await write(['data','state.json'], { seen_video_ids: nextSeen });

  console.log('[upd] missing game_id minutes:', missingGame);
  console.log('[upd] done ✔');
})().catch(e=>{ console.error('[upd] ERROR', e); process.exit(1); });
