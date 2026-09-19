import fs from "node:fs/promises";
import path from "node:path";

const dir = path.join(process.cwd(), "data", "twitch");

const required = [
  "current.json",
  "followers.json",
  "follower-history.json",
  "stream-history.json",
  "game-stats.json",
  "videos.json",
  "clips.json",
  "schedule.json",
  "summary.json",
  "health.json",
];

let failed = false;

async function load(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
  } catch (err) {
    console.error(`[FAIL] ${name}: invalid or missing JSON: ${err.message}`);
    failed = true;
    return null;
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    failed = true;
  }
}

const data = {};
for (const name of required) data[name] = await load(name);

const current = data["current.json"];
const followers = data["followers.json"];
const followerHistory = data["follower-history.json"];
const streamHistory = data["stream-history.json"];
const gameStats = data["game-stats.json"];
const videos = data["videos.json"];
const clips = data["clips.json"];
const schedule = data["schedule.json"];
const summary = data["summary.json"];
const health = data["health.json"];

if (current) {
  assert(typeof current.live === "boolean", "current.live must be boolean");
  assert(Number.isFinite(Number(current.followers_total)), "current.followers_total must be numeric");
}

if (followers) {
  assert(Number.isFinite(Number(followers.total)), "followers.total must be numeric");
  assert(Number(followers.total) >= 0, "followers.total cannot be negative");
}

if (followerHistory) assert(Array.isArray(followerHistory.days), "follower-history.days must be an array");
if (streamHistory) assert(Array.isArray(streamHistory.sessions), "stream-history.sessions must be an array");
if (gameStats) assert(Array.isArray(gameStats.games), "game-stats.games must be an array");
if (videos) assert(Array.isArray(videos.videos), "videos.videos must be an array");

if (clips) {
  assert(Array.isArray(clips.recent), "clips.recent must be an array");
  assert(Array.isArray(clips.top), "clips.top must be an array");
}

if (schedule) assert(Array.isArray(schedule.segments), "schedule.segments must be an array");
if (summary) assert(Number.isFinite(Number(summary.followers_total)), "summary.followers_total must be numeric");
if (health) assert(typeof health.ok === "boolean", "health.ok must be boolean");

for (const optional of ["follower-activity.json", "video-history.json", "clip-history.json"]) {
  try {
    JSON.parse(await fs.readFile(path.join(dir, optional), "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[FAIL] ${optional}: invalid JSON: ${err.message}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("Twitch data validation passed.");
