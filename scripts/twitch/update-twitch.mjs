import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCHEMA_VERSION = 2;

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
const broadcasterLogin = (process.env.TWITCH_BROADCASTER_LOGIN || "").trim().toLowerCase();
const refreshToken = process.env.TWITCH_USER_REFRESH_TOKEN || "";
const localUserTokenPath = path.join(process.cwd(), ".twitch-user-token.json");
const ghSecretsPat = process.env.GH_SECRETS_PAT || "";
const publishFollowerNames = /^true$/i.test(process.env.PUBLISH_FOLLOWER_NAMES || "");
const publishFullFollowerList = /^true$/i.test(process.env.PUBLISH_FULL_FOLLOWER_LIST || "");

const dataDir = path.join(process.cwd(), "data", "twitch");

if (!clientId || !clientSecret || !broadcasterLogin) {
  console.error("Missing TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, or TWITCH_BROADCASTER_LOGIN.");
  process.exit(1);
}

await fs.mkdir(dataDir, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function stripMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { _meta, ...rest } = value;
  return rest;
}

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, filename), "utf8"));
  } catch {
    return fallback;
  }
}

async function writeData(filename, payload, source = "twitch_api") {
  const target = path.join(dataDir, filename);
  const current = await readJson(filename, null);
  const currentPayload = stripMeta(current);

  const unchanged = current && current._meta?.schema_version === SCHEMA_VERSION &&
    JSON.stringify(currentPayload) === JSON.stringify(payload);

  if (unchanged) return false;

  const next = {
    _meta: {
      schema_version: SCHEMA_VERSION,
      source,
      updated_at: nowIso(),
    },
    ...payload,
  };

  await fs.writeFile(target, JSON.stringify(next, null, 2) + "\n", "utf8");
  return true;
}

async function readLocalUserToken() {
  try {
    return JSON.parse(await fs.readFile(localUserTokenPath, "utf8"));
  } catch {
    return null;
  }
}

async function writeLocalUserToken(tokenData) {
  const current = (await readLocalUserToken()) || {};
  const next = {
    ...current,
    ...tokenData,
    created_at: current.created_at || nowIso(),
    refreshed_at: nowIso(),
  };
  await fs.writeFile(localUserTokenPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

async function validateUserToken(accessToken) {
  if (!accessToken) return null;
  const res = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function getAppToken() {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Could not get Twitch app token: ${res.status} ${await res.text()}`);
  }

  return (await res.json()).access_token;
}

async function refreshUserToken(existingRefreshToken) {
  if (!existingRefreshToken) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: existingRefreshToken,
  });

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.warn(`Could not refresh moderator Twitch token: ${res.status} ${await res.text()}`);
    return null;
  }

  return res.json();
}

function rotateGitHubRefreshSecret(newRefreshToken) {
  if (!newRefreshToken || newRefreshToken === refreshToken) return;
  if (!ghSecretsPat || !process.env.GITHUB_REPOSITORY) {
    console.warn(
      "Twitch issued a new refresh token, but GH_SECRETS_PAT/GITHUB_REPOSITORY is unavailable. " +
      "The workflow cannot safely persist the rotated token."
    );
    return;
  }

  const result = spawnSync(
    "gh",
    ["secret", "set", "TWITCH_USER_REFRESH_TOKEN", "--repo", process.env.GITHUB_REPOSITORY],
    {
      input: newRefreshToken,
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: ghSecretsPat },
    }
  );

  if (result.status !== 0) {
    console.warn("Could not rotate TWITCH_USER_REFRESH_TOKEN in GitHub.");
    if (result.stderr) console.warn(result.stderr.trim());
  } else {
    console.log("Rotated TWITCH_USER_REFRESH_TOKEN in GitHub Actions secrets.");
  }
}

async function getModeratorUserToken() {
  const local = await readLocalUserToken();

  if (local?.access_token) {
    const validation = await validateUserToken(local.access_token);
    if (validation?.scopes?.includes("moderator:read:followers")) {
      return {
        accessToken: local.access_token,
        validation,
        source: "local_access_token",
      };
    }
  }

  const candidateRefreshToken = refreshToken || local?.refresh_token || "";
  if (!candidateRefreshToken) return null;

  const refreshed = await refreshUserToken(candidateRefreshToken);
  if (!refreshed?.access_token) return null;

  const validation = await validateUserToken(refreshed.access_token);
  if (!validation?.scopes?.includes("moderator:read:followers")) {
    console.warn("Moderator token is valid but missing moderator:read:followers.");
    return null;
  }

  if (local) {
    await writeLocalUserToken({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || candidateRefreshToken,
      expires_in: refreshed.expires_in,
      token_type: refreshed.token_type,
      user_id: validation.user_id,
      login: validation.login,
      scopes: validation.scopes,
    });
  }

  if (refreshed.refresh_token) rotateGitHubRefreshSecret(refreshed.refresh_token);

  return {
    accessToken: refreshed.access_token,
    validation,
    source: refreshToken ? "github_refresh_token" : "local_refresh_token",
  };
}

async function helix(endpoint, token) {
  const res = await fetch(`https://api.twitch.tv/helix${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": clientId,
    },
  });

  if (!res.ok) {
    throw new Error(`${endpoint} failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

const health = {
  ok: true,
  broadcaster_login: broadcasterLogin,
  endpoints: {},
  moderator_auth: {
    available: false,
    login: null,
    source: null,
  },
};

async function safeHelix(name, endpoint, token, { allow404 = false } = {}) {
  try {
    const value = await helix(endpoint, token);
    health.endpoints[name] = { ok: true };
    return value;
  } catch (err) {
    const message = String(err?.message || err);
    if (allow404 && message.includes("failed: 404")) {
      health.endpoints[name] = { ok: true, note: "not_configured_or_empty" };
      return null;
    }

    health.ok = false;
    health.endpoints[name] = { ok: false, error: message.slice(0, 500) };
    console.warn(`[${name}] ${message}`);
    return null;
  }
}

async function getAllFollowers(broadcasterId, token) {
  const followers = [];
  let cursor = "";
  let total = null;

  while (true) {
    const params = new URLSearchParams({ broadcaster_id: broadcasterId, first: "100" });
    if (cursor) params.set("after", cursor);

    const page = await helix(`/channels/followers?${params}`, token);
    if (total === null && Number.isFinite(Number(page.total))) total = Number(page.total);
    followers.push(...(page.data || []));

    cursor = page.pagination?.cursor || "";
    if (!cursor) return { total: total ?? followers.length, followers };
  }
}

async function getAllVideos(broadcasterId, token) {
  const videos = [];
  let cursor = "";

  while (true) {
    const params = new URLSearchParams({ user_id: broadcasterId, first: "100" });
    if (cursor) params.set("after", cursor);

    const page = await helix(`/videos?${params}`, token);
    videos.push(...(page.data || []));

    cursor = page.pagination?.cursor || "";
    if (!cursor || videos.length >= 1000) return videos;
  }
}

async function getClips(broadcasterId, token) {
  const clips = [];
  let cursor = "";
  const startedAt = new Date(Date.now() - 90 * 86400000).toISOString();

  while (true) {
    const params = new URLSearchParams({
      broadcaster_id: broadcasterId,
      first: "100",
      started_at: startedAt,
    });
    if (cursor) params.set("after", cursor);

    const page = await helix(`/clips?${params}`, token);
    clips.push(...(page.data || []));

    cursor = page.pagination?.cursor || "";
    if (!cursor || clips.length >= 1000) return clips;
  }
}

async function getGameNames(ids, token) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map();

  for (let i = 0; i < unique.length; i += 100) {
    const params = new URLSearchParams();
    for (const id of unique.slice(i, i + 100)) params.append("id", id);
    const result = await safeHelix(`games_${Math.floor(i / 100) + 1}`, `/games?${params}`, token);
    for (const game of result?.data || []) map.set(game.id, game.name);
  }

  return map;
}

function cleanVideo(v) {
  return {
    id: v.id,
    stream_id: v.stream_id,
    title: v.title,
    description: v.description,
    created_at: v.created_at,
    published_at: v.published_at,
    url: v.url,
    thumbnail_url: v.thumbnail_url,
    view_count: v.view_count,
    language: v.language,
    type: v.type,
    duration: v.duration,
  };
}

function cleanClip(c, gameNames) {
  return {
    id: c.id,
    url: c.url,
    embed_url: c.embed_url,
    broadcaster_id: c.broadcaster_id,
    broadcaster_name: c.broadcaster_name,
    creator_id: c.creator_id,
    creator_name: c.creator_name,
    video_id: c.video_id,
    game_id: c.game_id,
    game_name: gameNames.get(c.game_id) || null,
    language: c.language,
    title: c.title,
    view_count: c.view_count,
    created_at: c.created_at,
    thumbnail_url: c.thumbnail_url,
    duration: c.duration,
    vod_offset: c.vod_offset,
  };
}

function parseDurationSeconds(value) {
  const match = String(value || "").match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function secondsBetween(a, b) {
  if (!a || !b) return 0;
  const start = Date.parse(a);
  const end = Date.parse(b);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 1000);
}

function updateStreamHistory(history, stream) {
  const checkedAt = nowIso();
  const sessions = Array.isArray(history?.sessions) ? structuredClone(history.sessions) : [];
  let open = sessions.find((s) => !s.ended_at);

  if (!stream) {
    if (open) {
      open.ended_at = open.last_seen_at || checkedAt;
      open.end_is_approximate = true;
      const lastCategory = open.categories?.at(-1);
      if (lastCategory && !lastCategory.ended_at) lastCategory.ended_at = open.ended_at;
    }
    return { sessions };
  }

  if (open && open.stream_id !== stream.id) {
    open.ended_at = open.last_seen_at || stream.started_at;
    open.end_is_approximate = true;
    const lastCategory = open.categories?.at(-1);
    if (lastCategory && !lastCategory.ended_at) lastCategory.ended_at = open.ended_at;
    open = null;
  }

  if (!open) {
    open = {
      stream_id: stream.id,
      started_at: stream.started_at,
      first_seen_at: checkedAt,
      last_seen_at: checkedAt,
      ended_at: null,
      end_is_approximate: false,
      title_first_seen: stream.title,
      title_last_seen: stream.title,
      language: stream.language,
      peak_viewers_observed: Number(stream.viewer_count || 0),
      last_viewers_observed: Number(stream.viewer_count || 0),
      categories: [
        {
          game_id: stream.game_id || "",
          game_name: stream.game_name || "No Category",
          started_at: stream.started_at || checkedAt,
          ended_at: null,
        },
      ],
    };
    sessions.push(open);
  } else {
    open.last_seen_at = checkedAt;
    open.title_last_seen = stream.title;
    open.peak_viewers_observed = Math.max(
      Number(open.peak_viewers_observed || 0),
      Number(stream.viewer_count || 0)
    );
    open.last_viewers_observed = Number(stream.viewer_count || 0);

    const lastCategory = open.categories?.at(-1);
    const gameId = stream.game_id || "";
    if (!lastCategory || lastCategory.game_id !== gameId) {
      if (lastCategory && !lastCategory.ended_at) lastCategory.ended_at = checkedAt;
      open.categories ||= [];
      open.categories.push({
        game_id: gameId,
        game_name: stream.game_name || "No Category",
        started_at: checkedAt,
        ended_at: null,
      });
    }
  }

  return { sessions };
}

function makeGameStats(streamHistory) {
  const totals = new Map();

  for (const session of streamHistory?.sessions || []) {
    for (const segment of session.categories || []) {
      const end = segment.ended_at || session.last_seen_at || nowIso();
      const seconds = secondsBetween(segment.started_at, end);
      const key = segment.game_id || `name:${segment.game_name || "No Category"}`;
      const row = totals.get(key) || {
        game_id: segment.game_id || "",
        game_name: segment.game_name || "No Category",
        seconds: 0,
        stream_ids: new Set(),
      };
      row.seconds += seconds;
      row.stream_ids.add(session.stream_id);
      totals.set(key, row);
    }
  }

  return [...totals.values()]
    .map((row) => ({
      game_id: row.game_id,
      game_name: row.game_name,
      total_seconds_observed: row.seconds,
      total_hours_observed: Math.round((row.seconds / 3600) * 100) / 100,
      streams_observed: row.stream_ids.size,
    }))
    .sort((a, b) => b.total_seconds_observed - a.total_seconds_observed);
}

function updateFollowerHistory(history, total) {
  const date = new Date().toISOString().slice(0, 10);
  const days = Array.isArray(history?.days) ? structuredClone(history.days) : [];
  const existing = days.find((d) => d.date === date);

  if (existing) existing.total = total;
  else days.push({ date, total });

  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}

function followerNetDelta(days, targetDays) {
  if (!days.length) return null;
  const latest = days.at(-1);
  const targetTime = Date.parse(`${latest.date}T00:00:00Z`) - targetDays * 86400000;
  let baseline = null;

  for (const row of days) {
    const t = Date.parse(`${row.date}T00:00:00Z`);
    if (t <= targetTime) baseline = row;
    else break;
  }

  return baseline ? latest.total - baseline.total : null;
}

function makeFollowerActivity(followers) {
  const now = Date.now();
  const windows = { "1d": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000 };
  const gained = {};

  for (const [key, ms] of Object.entries(windows)) {
    gained[key] = followers.filter((f) => {
      const followed = Date.parse(f.followed_at);
      return Number.isFinite(followed) && followed >= now - ms;
    }).length;
  }

  const daily = new Map();
  const cutoff = now - 90 * 86400000;
  for (const follower of followers) {
    const followed = Date.parse(follower.followed_at);
    if (!Number.isFinite(followed) || followed < cutoff) continue;
    const date = new Date(followed).toISOString().slice(0, 10);
    daily.set(date, (daily.get(date) || 0) + 1);
  }

  return {
    gained_1d: gained["1d"],
    gained_7d: gained["7d"],
    gained_30d: gained["30d"],
    days: [...daily.entries()]
      .map(([date, new_followers]) => ({ date, new_followers }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function mergeHistory(previousRows, currentRows, dateKey = "created_at") {
  const map = new Map();
  for (const item of previousRows || []) if (item?.id) map.set(item.id, item);
  for (const item of currentRows || []) if (item?.id) map.set(item.id, item);
  return [...map.values()].sort((a, b) => Date.parse(b?.[dateKey] || 0) - Date.parse(a?.[dateKey] || 0));
}

function nextFollowerMilestone(total) {
  const size = total < 1000 ? 100 : 500;
  const next = Math.ceil((total + 1) / size) * size;
  return { target: next, remaining: Math.max(0, next - total) };
}

const previousCurrent = await readJson("current.json", null);
const previousFollowers = await readJson("followers.json", null);
const previousFollowerHistory = await readJson("follower-history.json", { days: [] });
const previousFollowerActivity = await readJson("follower-activity.json", null);
const previousStreamHistory = await readJson("stream-history.json", { sessions: [] });
const previousVideos = await readJson("videos.json", { videos: [] });
const previousVideoHistory = await readJson("video-history.json", { videos: [] });
const previousClips = await readJson("clips.json", { recent: [], top: [] });
const previousClipHistory = await readJson("clip-history.json", { clips: [] });
const previousSchedule = await readJson("schedule.json", { segments: [], vacation: null });

const appToken = await getAppToken();

const users = await safeHelix("users", `/users?login=${encodeURIComponent(broadcasterLogin)}`, appToken);
const broadcaster = users?.data?.[0];

if (!broadcaster) {
  health.ok = false;
  health.fatal_error = `Twitch user "${broadcasterLogin}" was not found or /users failed.`;
  await writeData("health.json", health, "naptek_twitch_collector");
  throw new Error(health.fatal_error);
}

const broadcasterId = broadcaster.id;

const [channelResult, streamResult, followerTotalResult, scheduleResult] = await Promise.all([
  safeHelix("channel", `/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`, appToken),
  safeHelix("stream", `/streams?user_id=${encodeURIComponent(broadcasterId)}`, appToken),
  safeHelix(
    "followers_total",
    `/channels/followers?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=1`,
    appToken
  ),
  safeHelix(
    "schedule",
    `/schedule?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=25`,
    appToken,
    { allow404: true }
  ),
]);

let videosResult = null;
try {
  videosResult = await getAllVideos(broadcasterId, appToken);
  health.endpoints.videos = { ok: true };
} catch (err) {
  health.ok = false;
  health.endpoints.videos = { ok: false, error: String(err?.message || err).slice(0, 500) };
  console.warn("[videos]", err.message);
}

let rawClips = null;
try {
  rawClips = await getClips(broadcasterId, appToken);
  health.endpoints.clips = { ok: true };
} catch (err) {
  health.ok = false;
  health.endpoints.clips = { ok: false, error: String(err?.message || err).slice(0, 500) };
  console.warn("[clips]", err.message);
}

const gameNames = rawClips
  ? await getGameNames(rawClips.map((c) => c.game_id), appToken)
  : new Map();

const streamEndpointOk = health.endpoints.stream?.ok === true;
const channel = channelResult?.data?.[0] || previousCurrent?.channel || null;
const liveStream = streamEndpointOk ? (streamResult?.data?.[0] || null) : (previousCurrent?.stream || null);

let followerTotal = Number(followerTotalResult?.total);
if (!Number.isFinite(followerTotal)) {
  followerTotal = Number(previousFollowers?.total ?? previousCurrent?.followers_total ?? 0);
}

const cleanedVideos = videosResult
  ? videosResult.map(cleanVideo)
  : (previousVideos?.videos || []);

const cleanedClips = rawClips
  ? rawClips.map((clip) => cleanClip(clip, gameNames))
  : mergeHistory(previousClips?.recent, previousClips?.top);

const recentClips = [...cleanedClips]
  .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
  .slice(0, 20);
const topClips90d = [...cleanedClips]
  .sort((a, b) => Number(b.view_count || 0) - Number(a.view_count || 0))
  .slice(0, 20);

let followerAccess = {
  authorized_list_access: false,
  fetched_count: 0,
  latest: publishFollowerNames ? (previousFollowers?.latest || []) : [],
};
let followerActivity = previousFollowerActivity ? stripMeta(previousFollowerActivity) : null;

const moderatorToken = await getModeratorUserToken();
if (moderatorToken?.accessToken) {
  health.moderator_auth = {
    available: true,
    login: moderatorToken.validation?.login || null,
    source: moderatorToken.source,
  };

  try {
    const full = await getAllFollowers(broadcasterId, moderatorToken.accessToken);
    followerTotal = Number(full.total ?? followerTotal);
    followerAccess.authorized_list_access = true;
    followerAccess.fetched_count = full.followers.length;
    followerActivity = makeFollowerActivity(full.followers);

    if (publishFollowerNames) {
      followerAccess.latest = full.followers.slice(0, 25).map((f) => ({
        user_id: f.user_id,
        user_login: f.user_login,
        user_name: f.user_name,
        followed_at: f.followed_at,
      }));
    }

    if (publishFullFollowerList) {
      await writeData(
        "followers-full.json",
        {
          broadcaster_id: broadcasterId,
          broadcaster_login: broadcasterLogin,
          total: followerTotal,
          followers: full.followers.map((f) => ({
            user_id: f.user_id,
            user_login: f.user_login,
            user_name: f.user_name,
            followed_at: f.followed_at,
          })),
        },
        "twitch_api_moderator"
      );
    } else {
      try {
        await fs.unlink(path.join(dataDir, "followers-full.json"));
      } catch {}
    }
  } catch (err) {
    health.ok = false;
    health.moderator_auth.error = String(err?.message || err).slice(0, 500);
    console.warn("Authorized follower-list fetch failed:", err.message);
  }
}

const followerHistory = updateFollowerHistory(previousFollowerHistory, followerTotal);
const streamHistory = streamEndpointOk
  ? updateStreamHistory(previousStreamHistory, streamResult?.data?.[0] || null)
  : stripMeta(previousStreamHistory);
const gameStats = makeGameStats(streamHistory);

const videoHistory = mergeHistory(previousVideoHistory?.videos, cleanedVideos, "created_at");
const clipHistory = mergeHistory(previousClipHistory?.clips, cleanedClips, "created_at");

const current = {
  broadcaster: {
    id: broadcaster.id,
    login: broadcaster.login,
    display_name: broadcaster.display_name,
    description: broadcaster.description,
    profile_image_url: broadcaster.profile_image_url,
    offline_image_url: broadcaster.offline_image_url,
    created_at: broadcaster.created_at,
  },
  channel: channel
    ? {
        broadcaster_id: channel.broadcaster_id,
        broadcaster_login: channel.broadcaster_login,
        broadcaster_name: channel.broadcaster_name,
        title: channel.title,
        game_id: channel.game_id,
        game_name: channel.game_name,
        broadcaster_language: channel.broadcaster_language,
        tags: channel.tags || [],
        content_classification_labels: channel.content_classification_labels || [],
      }
    : null,
  live: streamEndpointOk ? Boolean(streamResult?.data?.[0]) : Boolean(previousCurrent?.live),
  stream: streamEndpointOk
    ? (liveStream
        ? {
            id: liveStream.id,
            title: liveStream.title,
            game_id: liveStream.game_id,
            game_name: liveStream.game_name,
            viewer_count: liveStream.viewer_count,
            started_at: liveStream.started_at,
            language: liveStream.language,
            tags: liveStream.tags || [],
            thumbnail_url: liveStream.thumbnail_url,
          }
        : null)
    : (previousCurrent?.stream || null),
  followers_total: followerTotal,
  stale: {
    stream: !streamEndpointOk,
    channel: health.endpoints.channel?.ok !== true,
    followers_total:
      health.endpoints.followers_total?.ok !== true && !followerAccess.authorized_list_access,
  },
};

const followerDays = followerHistory.days || [];
const trackerSeconds = (streamHistory.sessions || []).reduce((sum, session) => {
  return sum + secondsBetween(session.started_at, session.ended_at || session.last_seen_at);
}, 0);
const availableVodSeconds = cleanedVideos.reduce((sum, video) => sum + parseDurationSeconds(video.duration), 0);
const milestone = nextFollowerMilestone(followerTotal);

const summary = {
  broadcaster_id: broadcasterId,
  broadcaster_login: broadcasterLogin,
  live: current.live,
  followers_total: followerTotal,
  follower_net_change_1d: followerNetDelta(followerDays, 1),
  follower_net_change_7d: followerNetDelta(followerDays, 7),
  follower_net_change_30d: followerNetDelta(followerDays, 30),
  followers_gained_1d: followerActivity?.gained_1d ?? null,
  followers_gained_7d: followerActivity?.gained_7d ?? null,
  followers_gained_30d: followerActivity?.gained_30d ?? null,
  next_follower_milestone: milestone.target,
  followers_to_milestone: milestone.remaining,
  tracked_streams: streamHistory.sessions?.length || 0,
  tracked_stream_seconds: trackerSeconds,
  tracked_stream_hours: Math.round((trackerSeconds / 3600) * 100) / 100,
  available_vods: cleanedVideos.length,
  available_vod_seconds: availableVodSeconds,
  discovered_videos: videoHistory.length,
  discovered_clips: clipHistory.length,
  top_games: gameStats.slice(0, 10),
};

const schedule = scheduleResult
  ? {
      broadcaster_id: broadcasterId,
      segments: scheduleResult.data?.segments || [],
      vacation: scheduleResult.data?.vacation || null,
    }
  : {
      broadcaster_id: broadcasterId,
      segments: previousSchedule?.segments || [],
      vacation: previousSchedule?.vacation || null,
    };

await Promise.all([
  writeData("current.json", current),
  writeData(
    "followers.json",
    {
      broadcaster_id: broadcasterId,
      broadcaster_login: broadcasterLogin,
      total: followerTotal,
      ...followerAccess,
    },
    followerAccess.authorized_list_access ? "twitch_api_moderator" : "twitch_api"
  ),
  writeData("follower-history.json", followerHistory, "derived_daily_totals"),
  followerActivity
    ? writeData("follower-activity.json", followerActivity, "derived_from_authorized_follower_list")
    : Promise.resolve(false),
  writeData("stream-history.json", streamHistory, "twitch_api_observed"),
  writeData("game-stats.json", { games: gameStats }, "derived_from_stream_history"),
  writeData("videos.json", { broadcaster_id: broadcasterId, videos: cleanedVideos }),
  writeData("video-history.json", { broadcaster_id: broadcasterId, videos: videoHistory }, "retained_twitch_video_metadata"),
  writeData(
    "clips.json",
    {
      broadcaster_id: broadcasterId,
      window_days: 90,
      recent: recentClips,
      top: topClips90d,
    }
  ),
  writeData("clip-history.json", { broadcaster_id: broadcasterId, clips: clipHistory }, "retained_twitch_clip_metadata"),
  writeData("schedule.json", schedule),
  writeData("summary.json", summary, "naptek_derived_summary"),
  writeData("health.json", health, "naptek_twitch_collector"),
]);

console.log(JSON.stringify({
  broadcaster: broadcaster.login,
  live: current.live,
  followers_total: followerTotal,
  authorized_follower_list: followerAccess.authorized_list_access,
  followers_fetched: followerAccess.fetched_count,
  streams_tracked: streamHistory.sessions?.length || 0,
  games_tracked: gameStats.length,
  videos_available: cleanedVideos.length,
  videos_retained: videoHistory.length,
  clips_retained: clipHistory.length,
  health_ok: health.ok,
}, null, 2));
