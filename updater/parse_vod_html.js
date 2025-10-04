// parse_vod_html.js — reads updater/vod_html/*.html to extract chapters
import fs from 'fs/promises';
import path from 'path';

const ROOT = path.resolve(process.cwd(), '..');
const HTML_DIR = path.join(ROOT, 'updater', 'vod_html');

export async function chaptersFromSavedHtml(videoId){
  try{
    const files = await fs.readdir(HTML_DIR).catch(()=>[]);
    if(!files.length) return [];
    const chosen = [];
    for(const f of files){
      if(!f.toLowerCase().endsWith('.html')) continue;
      const full = path.join(HTML_DIR,f);
      const txt = await fs.readFile(full,'utf8');
      if(!videoId || txt.includes(String(videoId))) chosen.push(txt);
    }
    if(!chosen.length) return [];
    const sum = new Map();
    const re = /"categoryDisplayName"\s*:\s*"([^"]+)"[\s\S]*?"durationMilliseconds"\s*:\s*(\d+)/g;
    for(const txt of chosen){
      let m; while((m=re.exec(txt))!==null){
        const name = m[1]; const minutes = Math.max(1, Math.ceil((+m[2]||0)/60000));
        const cur = sum.get(name) || { name, minutes:0, sessions:0 };
        cur.minutes += minutes; cur.sessions += 1; sum.set(name,cur);
      }
    }
    return [...sum.values()];
  }catch{ return []; }
}
