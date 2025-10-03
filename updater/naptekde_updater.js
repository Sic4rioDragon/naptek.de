// npm i node-fetch@3 dotenv
import 'dotenv/config'; import fetch from 'node-fetch'; import fs from 'fs/promises'; import path from 'path';

const { TWITCH_CLIENT_ID:CID, TWITCH_CLIENT_SECRET:CS, CHANNEL_LOGIN='nap_tek' } = process.env;
const root = path.resolve(process.cwd(), '..');               // repo root (../ from /updater)
const p = (...x)=>path.join(root, ...x);
const J = (o)=>JSON.stringify(o,null,2);
const rd = async f => { try{ return JSON.parse(await fs.readFile(p(...f),'utf8')); }catch{ return null; } };
const wr = async (f,o)=>{ await fs.mkdir(path.dirname(p(...f)),{recursive:true}); await fs.writeFile(p(...f), J(o)); };

const durMin = s => {
  // parse "2h13m5s" variants
  const n=(re)=> (s.match(re)?.[1] ? parseInt(s.match(re)[1],10) : 0);
  return n(/(\d+)h/) * 60 + n(/(\d+)m/) + Math.ceil(n(/(\d+)s/)/60);
};

const token = async () => (await (await fetch('https://id.twitch.tv/oauth2/token',{
  method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:CID,client_secret:CS,grant_type:'client_credentials'})
})).json()).access_token;

const H = t => ({ 'Client-ID': CID, 'Authorization': `Bearer ${t}` });
const api = (t,p,q='') => fetch(`https://api.twitch.tv/helix/${p}${q?`?${q}`:''}`,{headers:H(t)}).then(r=>r.json());

(async () => {
  const t = await token();
  const u = await api(t,'users','login='+encodeURIComponent(CHANNEL_LOGIN)); 
  const uid = u.data?.[0]?.id; if(!uid) throw new Error('Channel not found');

  // --- CLIPS (just refresh last 20) ---
  const clips = (await api(t,'clips',`broadcaster_id=${uid}&first=20`)).data?.map(c=>({
    id:c.id,title:c.title,created_at:c.created_at,creator_name:c.creator_name
  })) || [];
  await wr(['data','clips.json'], clips);

  // --- VIDEOS (past broadcasts) ---
  const vids = (await api(t,'videos',`user_id=${uid}&type=archive&first=50`)).data || [];
  const state = await rd(['data','state.json']) || { seen_video_ids: [] };
  const seen = new Set(state.seen_video_ids);
  const fresh = vids.filter(v => !seen.has(v.id));                 // new ones only

  // minutes per game from fresh VODs
  const per = {}; let addOverall = 0;
  fresh.forEach(v => {
    const m = durMin(v.duration || '0m'); addOverall += m;
    if (v.game_id) per[v.game_id] = (per[v.game_id]||0) + m;
  });

  // lookup game names once
  const ids = Object.keys(per);
  let names = {};
  if (ids.length){
    const r = await api(t,'games', ids.map(id=>`id=${id}`).join('&'));
    (r.data||[]).forEach(g => names[g.id]=g.name);
  }

  // merge into games.json (no delete)
  const games = await rd(['data','games.json']) || [];
  const byName = new Map(games.map(g => [g.name, g]));
  ids.forEach(id => {
    const name = names[id] || `Game ${id}`;
    const row = byName.get(name) || { name, sessions:0, minutes_total:0, platform:'PC' };
    row.sessions += vids.filter(v => !seen.has(v.id) && v.game_id===id).length;
    row.minutes_total += per[id];
    const last = vids.find(v => v.game_id===id)?.published_at;
    row.last_streamed = last || row.last_streamed || null;
    byName.set(name, row);
  });
  const merged = Array.from(byName.values()).sort((a,b)=> (b.minutes_total||0)-(a.minutes_total||0));
  await wr(['data','games.json'], merged);

  // update overall stats (additive)
  const stats = await rd(['data','stream_stats.json']) || { minutes_total_overall: 0, updated_at: null };
  stats.minutes_total_overall += addOverall;
  stats.updated_at = new Date().toISOString();
  await wr(['data','stream_stats.json'], stats);

  // update state (remember processed videos, cap to last 500 ids)
  const nextSeen = Array.from(new Set([...state.seen_video_ids, ...fresh.map(v=>v.id)])).slice(-500);
  await wr(['data','state.json'], { seen_video_ids: nextSeen });

  console.log(`Clips:${clips.length} | New VODs:${fresh.length} | +${addOverall} minutes | Games:${merged.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });
