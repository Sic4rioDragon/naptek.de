// supporters_updater.js — writes supporters skeleton until broadcaster token with scopes is provided
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const ROOT = path.resolve(process.cwd(), '..');
const DATA = path.join(ROOT, 'data');
const P = f => path.join(DATA,f);
const CID = process.env.TWITCH_CLIENT_ID;
const TOKEN = process.env.BROADCASTER_OAUTH_TOKEN;   // needs channel:read:subscriptions, moderator:read:followers
const CHANNEL_ID = process.env.CHANNEL_ID || '90694891'; // nap_Tek

function ensureDir(){ if(!fs.existsSync(DATA)) fs.mkdirSync(DATA,{recursive:true}); }
function jwrite(f,o){ fs.writeFileSync(P(f), JSON.stringify(o,null,2)); }
async function helix(ep, params){
  const url = new URL(`https://api.twitch.tv/helix/${ep}`);
  Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const r = await fetch(url,{headers:{'Client-Id':CID, Authorization:`Bearer ${TOKEN}`}}); if(!r.ok) throw new Error(`${ep} ${r.status}`);
  return r.json();
}
(async ()=>{
  ensureDir();
  if(!TOKEN){
    console.log('[sup] no broadcaster token; writing empty supporters skeleton');
    jwrite('supporters.json',{ subs:[], followers:[], vips:[], updated_at:new Date().toISOString() });
    return;
  }
  const subs = await helix('subscriptions',{ broadcaster_id: CHANNEL_ID, first:100 }).catch(()=>({data:[]}));
  const followers = await helix('channels/followers',{ broadcaster_id: CHANNEL_ID, first:100 }).catch(()=>({data:[]}));
  const vips = await helix('channels/vips',{ broadcaster_id: CHANNEL_ID, first:100 }).catch(()=>({data:[]}));
  jwrite('supporters.json',{
    subs:(subs.data||[]).map(s=>({user_id:s.user_id,user_name:s.user_name,tier:s.tier,is_gift:s.is_gift})),
    followers:(followers.data||[]).map(f=>({user_id:f.user_id,user_name:f.user_name})),
    vips:(vips.data||[]).map(v=>({user_id:v.user_id,user_name:v.user_name})),
    updated_at:new Date().toISOString()
  });
  console.log('[sup] wrote supporters.json');
})().catch(e=>{ console.error('[sup] ERROR',e); process.exit(1); });
