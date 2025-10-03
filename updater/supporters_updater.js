// npm i node-fetch@3 dotenv
import 'dotenv/config';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const { TWITCH_CLIENT_ID:CID, TWITCH_ACCESS_TOKEN:USER_TOKEN, CHANNEL_LOGIN='nap_tek' } = process.env;
// USER_TOKEN must be a *User* token for the channel with scope: channel:read:subscriptions

const ROOT = path.resolve(process.cwd(), '..');
const P = (...x) => path.join(ROOT, ...x);
const J = (o) => JSON.stringify(o, null, 2);
const read = async f => { try { return JSON.parse(await fs.readFile(P(...f),'utf8')); } catch { return null; } };
const write = async (f,o) => { await fs.mkdir(path.dirname(P(...f)),{recursive:true}); await fs.writeFile(P(...f),J(o)); };

const H = { 'Client-ID': CID, Authorization: `Bearer ${USER_TOKEN}` };
const api = (p,q='') => fetch(`https://api.twitch.tv/helix/${p}${q?`?${q}`:''}`, {headers:H}).then(r=>r.json());

(async () => {
  if(!USER_TOKEN){ console.log('[sup] No USER token; skip'); return; }
  const u = await api('users','login='+encodeURIComponent(CHANNEL_LOGIN));
  const uid = u.data?.[0]?.id; if(!uid){ console.log('[sup] channel not found'); return; }

  // paginate subscriptions
  let subs=[], cursor='';
  while(true){
    const q = `broadcaster_id=${uid}${cursor?`&after=${cursor}`:''}`;
    const r = await api('subscriptions', q); subs.push(...(r.data||[]));
    cursor = r.pagination?.cursor; if(!cursor) break;
  }
  // normalize
  const now = new Date().toISOString();
  const current = subs.map(s => ({
    user_id: s.user_id,
    display_name: s.user_name,
    tier: Number(String(s.tier||'1000').slice(0,1)),
    cumulative_months: s.cumulative_months || 0,
    as_of: now
  }));

  // load existing history and merge (track highest streak)
  const hist = await read(['data','sub_history.json']) || { members:{}, snapshots:[] };
  current.forEach(s => {
    const m = hist.members[s.user_id] || { display_name:s.display_name, highest_streak:0, first_seen: now, last_seen: null };
    m.display_name = s.display_name;
    m.highest_streak = Math.max(m.highest_streak, s.cumulative_months||0);
    m.last_seen = now;
    hist.members[s.user_id] = m;
  });
  hist.snapshots.push({ as_of: now, count: current.length });

  await write(['data','sub_history.json'], hist);
  console.log('[sup] snapshot:', current.length, 'unique members:', Object.keys(hist.members).length);
})().catch(e=>{ console.error('[sup] ERROR', e); process.exit(1); });
