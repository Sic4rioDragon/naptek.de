// fetch_vod_html.js — fetch VOD HTML to updater/vod_html/<id>.html
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

const ROOT = path.resolve(process.cwd(), '..');
const OUTDIR = path.join(ROOT, 'updater', 'vod_html');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export async function downloadVodHtml(videoId) {
  try {
    await fs.mkdir(OUTDIR, { recursive: true });
    const url = `https://www.twitch.tv/videos/${videoId}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    if (!r.ok) { console.log('[html] fetch fail', videoId, r.status); return false; }
    const html = await r.text();
    const file = path.join(OUTDIR, `${videoId}.html`);
    await fs.writeFile(file, html);
    console.log('[html] saved', file, html.length, 'bytes');
    return true;
  } catch (e) {
    console.log('[html] error', videoId, e.message);
    return false;
  }
}
