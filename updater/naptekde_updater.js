// npm i node-fetch@3 dotenv
import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

// config comes from /updater/.env (keep it secret, keep it safe)
const { TWITCH_CLIENT_ID: CID, TWITCH_CLIENT_SECRET: CS, CHANNEL_LOGIN = 'nap_tek' } = process.env;

// paths: script lives in /updater, data lives one folder up in /data
const root = path.resolve(process.cwd(), '..');
const P = (...x) => path.join(root, ...x);
const J = (o) => JSON.stringify(o, null, 2);
const readJSON  = async (f) => { try { return JSON.parse(await fs.readFile(P(...f), 'utf8')); } catch { return null; } };
const writeJSON = async (f,o) => { await fs.mkdir(path.dirname(P(...f)), { recursive:true }); await fs.writeFile(P(...f), J(o)); };

// twitch says durations like "2h13m5s" — turn that into whole minutes
const toMinutes = (s='0m') => {
  const pick = (re) => (s.match(re)?.[1] ? parseInt(s.match(re)[1],10) : 0);
  return pick(/(\d+)h/)*60 + pick(/(\d+)m/) + Math.ceil(pick(/(\d+)s/)/60);
};

// quick app token (client credentials)
const appToken = async () => (await (await fetch('https://id.twitch.tv/oauth2/token', {
  method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({ client_id:CID, client_secret:CS, grant_type:'client_credentials' })
})).json()).access_token;

const H   = (t) => ({ 'Client-ID': CID, Authorization: `Bearer ${t}` });
const api = (t, p, q='') => fetch(`https://api.twitch.tv/helix/${p}${q?`?${q}`:''}`, { headers:H(t) }).then(r=>r.json());

(async () => {
  const t   = await appToken();
  const usr = await api(t, 'users', 'login=' + encodeURIComponent(CHANNEL_LOGIN));
  const uid = usr.data?.[0]?.id; if (!uid) throw new Error('Channel not found 🙃');

  // --- CLIPS: just refresh recent 20 (cheap + good enough) ---
  const clips = (await api(t, 'clips', `broadcaster_id=${uid}&first=20`)).data?.map(c => ({
    id:c.id, title:c.title, created_at:c.created_at, creator_name:c.creator_name
  })) || [];
  await writeJSON(['data','clips.json'], clips);

  // --- VODS: grab the newest past broadcasts (up to 50) ---
  const vods  = (await api(t, 'videos', `user_id=${uid}&type=archive&first=50`)).data || [];
  const state = await readJSON(['data','state.json']) || { seen_video_ids: [] };
  const seen  = new Set(state.seen_video_ids);
  const fresh = vods.filter(v => !seen.has(v.id));          // only new ones since last run

  // --- STREAM LOG: append new VODs (no duplicates, no deletes) ---
  const logPath = ['data','streams.json'];
  const logOld  = await readJSON(logPath) || [];            // [{id, game_name, minutes, published_at}]
  const needIds = {};                                       // game_id -> name (we fill names below)
  fresh.forEach(v => { if (v.game_id) needIds[v.game_id] = null; });
  if (Object.keys(needIds).length) {
    const r = await api(t, 'games', Object.keys(needIds).map(id=>`id=${id}`).join('&'));
    (r.data||[]).forEach(g => needIds[g.id] = g.name);
  }
  const newLog = fresh.map(v => ({
    id: v.id,
    game_name: v.game_id ? (needIds[v.game_id] || `Game ${v.game_id}`) : 'Unk',
    minutes: toMinutes(v.duration),
    published_at: v.published_at
  }));
  await writeJSON(logPath, logOld.concat(newLog));          // append-only, forever

  // --- AGGREGATION: add minutes/sessions into games + bump overall total ---
  const addByGame = {}; let addOverall = 0;
  fresh.forEach(v => {
    const m = toMinutes(v.duration); addOverall += m;
    if (v.game_id) addByGame[v.game_id] = (addByGame[v.game_id] || 0) + m;
  });

  // look up names for the game ids we touched this run
  const touchedIds = Object.keys(addByGame);
  let names = {};
  if (touchedIds.length) {
    const r = await api(t, 'games', touchedIds.map(id=>`id=${id}`).join('&'));
    (r.data||[]).forEach(g => names[g.id] = g.name);
  }

  // merge into games.json (we only ever add — never delete)
  const gamesOld = await readJSON(['data','games.json']) || [];
  const byName   = new Map(gamesOld.map(g => [g.name, g]));
  touchedIds.forEach(id => {
    const name = names[id] || `Game ${id}`;
    const row  = byName.get(name) || { name, sessions:0, minutes_total:0, platform:'PC' };
    row.sessions     += fresh.filter(v => v.game_id === id).length;
    row.minutes_total+= addByGame[id];
    const last        = vods.find(v => v.game_id === id)?.published_at;
    row.last_streamed = last || row.last_streamed || null;
    byName.set(name, row);
  });
  const gamesNew = Array.from(byName.values()).sort((a,b)=> (b.minutes_total||0)-(a.minutes_total||0));
  await writeJSON(['data','games.json'], gamesNew);

  // overall totals: just keep counting up
  const stats = await readJSON(['data','stream_stats.json']) || { minutes_total_overall: 0, updated_at: null };
  stats.minutes_total_overall += addOverall;
  stats.updated_at = new Date().toISOString();
  await writeJSON(['data','stream_stats.json'], stats);

  // remember we processed these VOD ids (cap to last 500 just to keep file tiny)
  const nextSeen = Array.from(new Set([...state.seen_video_ids, ...fresh.map(v=>v.id)])).slice(-500);
  await writeJSON(['data','state.json'], { seen_video_ids: nextSeen });

  console.log(`Clips:${clips.length} | New VODs:${fresh.length} | +${addOverall} min | Games:${gamesNew.length}`);
})().catch(e => { console.error(e); process.exit(1); });
