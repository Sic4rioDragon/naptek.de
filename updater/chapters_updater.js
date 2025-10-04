// ESM – pause player, open chapter popover, click each chapter,
// re-open the popover between clicks, wait long enough so the player clock
// stabilizes, compute durations, auto-fix small drift (<=120s) to match VOD total.
// ENV knobs: NO_HEADLESS, ACTION_DELAY_MS, PER_VOD_IDLE_MS, CHAPTERS_LIMIT,
//            WAIT_AFTER_SEEK_MS, PUPPETEER_EXECUTABLE_PATH

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const DATA = (p) => path.join(ROOT, "data", p);
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, obj) =>
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");

// ---- args / env
const argv = process.argv.slice(2);
const getArg = (flag) => {
  const ix = argv.findIndex((a) => a === flag || a.startsWith(flag + "="));
  if (ix < 0) return null;
  if (argv[ix].includes("=")) return argv[ix].split("=")[1];
  return argv[ix + 1] ?? null;
};

const LIMIT = Number(getArg("--limit") ?? process.env.CHAPTERS_LIMIT ?? 0) || 0;
const HEADLESS = !process.env.NO_HEADLESS;
const EXE = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
const ACTION_DELAY_MS = Number(process.env.ACTION_DELAY_MS || 900);
const WAIT_AFTER_SEEK_MS = Number(process.env.WAIT_AFTER_SEEK_MS || 1800);
const PER_VOD_IDLE_MS = Number(process.env.PER_VOD_IDLE_MS || 2500);
const NAV_TIMEOUT = 60_000;

// ---- utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const near = (a, b, eps = 1) => Math.abs(a - b) <= eps; // seconds tolerance

const hmsToSeconds = (txt) => {
  if (!txt) return 0;
  const parts = txt.trim().split(":").map((n) => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
};

async function boot() {
  const browser = await puppeteer.launch({
    headless: HEADLESS ? "new" : false,
    executablePath: EXE,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--mute-audio",
      "--disable-gpu",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const t = req.resourceType();
    if (["font", "manifest"].includes(t)) return req.abort();
    if (/doubleclick|googlesyndication|adsystem|adservice/.test(req.url()))
      return req.abort();
    req.continue();
  });
  return { browser, page };
}

async function clickButtonByText(page, texts) {
  return page.evaluate((textsIn) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const wants = textsIn.map(norm);
    const btns = Array.from(document.querySelectorAll("button"));
    for (const b of btns) {
      const label = norm(b.textContent || b.getAttribute("aria-label") || "");
      if (!label) continue;
      if (wants.some((w) => label.includes(w))) {
        b.click();
        return true;
      }
    }
    return false;
  }, texts);
}

async function handleGates(page) {
  // cookies / mature / start watching
  await clickButtonByText(page, [
    "accept",
    "alle akzeptieren",
    "akzeptieren",
    "zustimmen",
  ]);
  await sleep(ACTION_DELAY_MS);
  await clickButtonByText(page, [
    "start watching",
    "weiter ansehen",
    "weiter",
    "watch stream",
  ]);
  await sleep(ACTION_DELAY_MS);
}

async function ensurePaused(page) {
  const sel = 'button[data-a-target="player-play-pause-button"]';
  const exists = await page.$(sel);
  if (!exists) return;
  const state = await page.$eval(sel, (btn) => btn.getAttribute("data-a-player-state"));
  if (state === "playing") {
    await page.click(sel).catch(() => {});
    await sleep(ACTION_DELAY_MS);
  }
}

async function ensureAtZero(page) {
  // ensure current time shows 00:00:00 (or near)
  const curTxt = await page
    .$eval('[data-a-target="player-seekbar-current-time"]', (n) => n.textContent.trim())
    .catch(() => null);
  const cur = hmsToSeconds(curTxt || "");
  if (cur <= 1) return;

  const bar = await page.$('[data-a-target="player-seekbar"]');
  if (bar) {
    const box = await bar.boundingBox();
    if (box) {
      const x = Math.floor(box.x + 3);
      const y = Math.floor(box.y + box.height / 2);
      await page.mouse.move(x, y);
      await sleep(100);
      await page.mouse.click(x, y);
      await sleep(ACTION_DELAY_MS);
      await ensurePaused(page);
    }
  }
}

async function openChapters(page) {
  let btn = await page.$('button[aria-label="Chapter Select"]');
  if (!btn) {
    await clickButtonByText(page, [
      "chapter select",
      "kapitel",
      "kapitel auswählen",
      "chapter",
    ]);
    await sleep(ACTION_DELAY_MS);
    btn = await page.$('button[aria-label="Chapter Select"]');
  }
  if (!btn) return false;
  await btn.click().catch(() => {});
  await sleep(ACTION_DELAY_MS);
  const ok = await page
    .waitForSelector("#chapter-select-popover-body", { timeout: 8000 })
    .catch(() => null);

  // make sure items are visible; some layouts virtualize/clip
  if (ok) {
    await page.evaluate(() => {
      const body = document.querySelector("#chapter-select-popover-body");
      if (body) body.scrollTop = 0;
    }).catch(() => {});
  }
  return !!ok;
}

async function readPlayerTimes(page) {
  // precise total: data-a-value
  let totalSecPrecise = await page
    .$eval(
      '[data-a-target="player-seekbar-duration"]',
      (n) => Number(n.getAttribute("data-a-value")) || 0
    )
    .catch(() => 0);

  // fallbacks
  if (!totalSecPrecise) {
    const totTxt =
      (await page
        .$eval('[data-a-target="player-seekbar-duration"]', (n) => n.textContent.trim())
        .catch(() => null)) || "";
    totalSecPrecise = hmsToSeconds(totTxt);
  }

  const curTxt = await page
    .$eval('[data-a-target="player-seekbar-current-time"]', (n) => n.textContent.trim())
    .catch(() => null);

  return {
    currentSec: hmsToSeconds(curTxt || ""),
    totalSec: totalSecPrecise,
  };
}

async function scrapeOneVod(page, id) {
  const url = `https://www.twitch.tv/videos/${id}`;
  await page.goto(url, { waitUntil: "networkidle2" });
  await sleep(800);

  await handleGates(page);

  // make controls visible, pause, snap to 0, read total
  await page.mouse.move(450, 320);
  await sleep(250);
  await ensurePaused(page);
  await ensureAtZero(page);
  let { totalSec } = await readPlayerTimes(page);

  // open chapter list once
  let opened = await openChapters(page);
  if (!opened) return { chapters: [], totalSec: totalSec || 0 };

  // helper to get buttons
  const getButtons = () =>
    page.$$("#chapter-select-popover-body .media-row button");

  await page.waitForSelector("#chapter-select-popover-body .media-row button", {
    timeout: 8000,
  });

  const names = [];
  const starts = [];
  const seenStarts = new Set();

  // iterate by index; after each click the popover may close → reopen
  let idx = 0;
  while (true) {
    let btns = await getButtons();
    if (!btns || btns.length === 0) {
      // popover likely closed; reopen and try again
      opened = await openChapters(page);
      if (!opened) break;
      btns = await getButtons();
      if (!btns || btns.length === 0) break;
    }
    if (idx >= btns.length) break;

    const btn = btns[idx];

    // name before click
    const name = await btn
      .$eval(".media-row__info-text p", (n) => n.textContent.trim())
      .catch(() => null);

    // click this chapter (seeks), wait + pause again
    await btn.click().catch(() => {});
    await sleep(ACTION_DELAY_MS + WAIT_AFTER_SEEK_MS);
    await ensurePaused(page);

    const t = await readPlayerTimes(page);
    if (t.totalSec) totalSec = t.totalSec; // refresh if lazy
    const startRounded = Math.round(clamp(t.currentSec, 0, totalSec || 1e9));

    if (name && ![...seenStarts].some((s) => near(s, startRounded, 1))) {
      names.push(name);
      starts.push(startRounded);
      seenStarts.add(startRounded);
    }

    // Re-open the popover BEFORE the next index (Twitch tends to close it)
    opened = await openChapters(page);
    if (!opened) break;

    idx += 1;
  }

  if (!starts.length) return { chapters: [], totalSec: totalSec || 0 };

  // sort + compute raw durations
  const pairs = names.map((n, i) => ({ n, t: starts[i] })).sort((a, b) => a.t - b.t);
  const chapters = [];
  for (let i = 0; i < pairs.length; i++) {
    const start = pairs[i].t;
    const next = i + 1 < pairs.length ? pairs[i + 1].t : totalSec;
    const dur = Math.max(0, next - start);
    chapters.push({ game: pairs[i].n, seconds: dur });
  }

  // sanity: adjust to total if within 120s; otherwise warn
  const sum = chapters.reduce((a, c) => a + c.seconds, 0);
  const diff = Math.round((totalSec || sum) - sum);
  if (Math.abs(diff) > 0 && Math.abs(diff) <= 120 && chapters.length > 0) {
    chapters[0].seconds = Math.max(0, chapters[0].seconds + diff);
  } else if (Math.abs(diff) > 120) {
    console.log(
      `[warn] ${id} chapter sum ${sum}s differs from total ${totalSec}s by ${diff}s (>120).`
    );
  }

  return { chapters, totalSec };
}

(async () => {
  const streams = readJSON(DATA("streams.json")); // produced by naptekde_updater.js
  const take = LIMIT > 0 ? streams.slice(0, LIMIT) : streams;
  console.log(`[chap] scraping chapters for ${take.length}/${streams.length} VODs…`);

  const { browser, page } = await boot();

  // aggregate seconds + sessions
  const aggSeconds = new Map();
  const aggSessions = new Map();
  let totalSeconds = 0;

  for (let i = 0; i < take.length; i++) {
    const s = take[i];
    try {
      const { chapters } = await scrapeOneVod(page, s.id);
      console.log(`[${i + 1}/${take.length}] ${s.id} chapters: ${chapters.length}`);

      const gamesSeenThisVod = new Set();
      for (const c of chapters) {
        if (!c.game) continue;
        aggSeconds.set(c.game, (aggSeconds.get(c.game) || 0) + c.seconds);
        totalSeconds += c.seconds;
        gamesSeenThisVod.add(c.game);
      }
      for (const g of gamesSeenThisVod) {
        aggSessions.set(g, (aggSessions.get(g) || 0) + 1);
      }

      await sleep(PER_VOD_IDLE_MS);
    } catch (e) {
      console.log(`[${i + 1}/${take.length}] ${s.id} error: ${e.message}`);
    }
  }

  await browser.close();

  const games = [...aggSeconds.entries()]
    .map(([name, secs]) => ({
      name,
      sessions: aggSessions.get(name) || 1,
      minutes_total: Math.floor(secs / 60),
      seconds_remainder: secs % 60,
      platform: "PC",
      last_streamed: new Date().toISOString(),
    }))
    .sort((a, b) => b.minutes_total - a.minutes_total);

  if (!games.length) {
    console.log("[chap] No chapter data found.");
    return;
  }

  writeJSON(DATA("games.json"), games);
  writeJSON(DATA("stream_stats.json"), {
    minutes_total_overall: Math.floor(totalSeconds / 60),
    seconds_remainder_overall: totalSeconds % 60,
    games_total: games.length,
    updated_at: new Date().toISOString(),
    source: "chapters-click+seekbar-total+reopen",
  });

  console.log(
    `[chap] wrote games.json (${games.length} categories), total minutes: ${Math.floor(
      totalSeconds / 60
    )} (+${totalSeconds % 60}s)`
  );
})().catch((e) => {
  console.error("[chap] fatal", e);
  process.exit(1);
});
