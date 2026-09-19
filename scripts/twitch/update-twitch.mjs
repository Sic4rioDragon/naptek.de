import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, filename), "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filename, value) {
  const target = path.join(dataDir, filename);
  const next = JSON.stringify(value, null, 2) + "\n";
  let current = "";
  try {
    current = await fs.readFile(target, "utf8");
  } catch {}
  if (current !== next) {
    await fs.writeFile(target, next, "utf8");
    return true;
  }
  return false;
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
  return await res.json();
}

async function getModeratorUserToken() {
  const local = await readLocalUserToken();

  if (local?.access_token) {
    const validation = await validateUserToken(local.access_token);
    const scopes = validation?.scopes || [];
    if (validation && scopes.includes("moderator:read:followers")) {
      return { accessToken: local.access_token, source: "local_access_token" };
    }
  }

  const candidateRefreshToken = refreshToken || local?.refresh_token || "";
  if (!candidateRefreshToken) return null;

  const refreshed = await refreshUserToken(candidateRefreshToken);
  if (!refreshed?.access_token) return null;

  const validation = await validateUserToken(refreshed.access_token);
  const scopes = validation?.scopes || [];
  if (!validation || !scopes.includes("moderator:read:followers")) {
    console.warn("Moderator Twitch token is missing moderator:read:followers after refresh.");
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
  return { accessToken: refreshed.access_token, source: refreshToken ? "env_refresh_token" : "local_refresh_token" };
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

  return await res.json();
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
    [
      "secret",
      "set",
      "TWITCH_USER_REFRESH_TOKEN",
      "--repo",
      process.env.GITHUB_REPOSITORY,
    ],
    {
      input: newRefreshToken,
      encoding: "utf8",
      env: {
        ...process.env,
        GH_TOKEN: ghSecretsPat,
      },
    }
  );

  if (result.status !== 0) {
    console.warn("Could not rotate TWITCH_USER_REFRESH_TOKEN in GitHub.");
    if (result.stderr) console.warn(result.stderr.trim());
  } else {
    console.log("Rotated TWITCH_USER_REFRESH_TOKEN in GitHub Actions secrets.");
  }
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

  return await res.json();
}

async function getAllFollowers(broadcasterId, token) {
  const followers = [];
  let cursor = "";

  while (true) {
    const params = new URLSearchParams({
      broadcaster_id: broadcasterId,
      first: "100",
    });
    if (cursor) params.set("after", cursor);

    const page = await helix(`/channels/followers?${params}`, token);
    followers.push(...(page.data || []));
    cursor = page.pagination?.cursor || "";
    if (!cursor) {
      return { total: page.total ?? followers.length, followers };
    }
  }
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

function cleanClip(c) {
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
    language: c.language,
    title: c.title,
    view_count: c.view_count,
    created_at: c.created_at,
    thumbnail_url: c.thumbnail_url,
    duration: c.duration,
    vod_offset: c.vod_offset,
  };
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
  const sessions = Array.isArray(history.sessions) ? history.sessions : [];
  let open = sessions.find((s) => !s.ended_at);

  if (!stream) {
    if (open) {
      open.ended_at = open.last_seen_at || checkedAt;
      open.end_is_approximate = true;
      const lastCategory = open.categories?.at(-1);
      if (lastCategory && !lastCategory.ended_at) {
        lastCategory.ended_at = open.ended_at;
      }
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
      peak_viewers_observed: stream.viewer_count ?? 0,
      last_viewers_observed: stream.viewer_count ?? 0,
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
  const sessions = streamHistory.sessions || [];

  for (const session of sessions) {
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

  return Array.from(totals.values())
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
  const days = Array.isArray(history.days) ? history.days : [];
  const existing = days.find((d) => d.date === date);

  if (existing) {
    existing.total = total;
  } else {
    days.push({ date, total });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}

function followerDelta(days, targetDays) {
  if (!days.length) return null;
  const latest = days.at(-1);
  const targetTime = Date.parse(`${latest.date}T00:00:00Z`) - targetDays * 86400000;
  let baseline = null;

  for (const row of days) {
    const t = Date.parse(`${row.date}T00:00:00Z`);
    if (t <= targetTime) baseline = row;
    else break;
  }

  if (!baseline) return null;
  return latest.total - baseline.total;
}

const appToken = await getAppToken();

const users = await helix(`/users?login=${encodeURIComponent(broadcasterLogin)}`, appToken);
const broadcaster = users.data?.[0];
if (!broadcaster) {
  throw new Error(`Twitch user "${broadcasterLogin}" was not found.`);
}

const broadcasterId = broadcaster.id;

const [
  channelResult,
  streamResult,
  followerTotalResult,
  videosResult,
  scheduleResult,
] = await Promise.all([
  helix(`/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`, appToken),
  helix(`/streams?user_id=${encodeURIComponent(broadcasterId)}`, appToken),
  helix(`/channels/followers?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=1`, appToken),
  helix(`/videos?user_id=${encodeURIComponent(broadcasterId)}&first=20`, appToken),
  helix(`/schedule?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=25`, appToken)
    .catch((err) => {
      if (!String(err?.message || "").includes("failed: 404")) {
        console.warn("Schedule unavailable:", err.message);
      }
      return { data: { segments: [], broadcaster_id: broadcasterId } };
    }),
]);

const channel = channelResult.data?.[0] || null;
const stream = streamResult.data?.[0] || null;
let followerTotal = Number(followerTotalResult.total || 0);

const clipsStart = new Date(Date.now() - 90 * 86400000).toISOString();
const clipsResult = await helix(
  `/clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=100&started_at=${encodeURIComponent(clipsStart)}`,
  appToken
);

const allClips = (clipsResult.data || []).map(cleanClip);
const recentClips = [...allClips]
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  .slice(0, 20);
const topClips90d = [...allClips]
  .sort((a, b) => Number(b.view_count || 0) - Number(a.view_count || 0))
  .slice(0, 20);

let followerAccess = {
  authorized_list_access: false,
  fetched_count: 0,
  latest: [],
};

const moderatorToken = await getModeratorUserToken();
if (moderatorToken?.accessToken) {
  try {
    const full = await getAllFollowers(broadcasterId, moderatorToken.accessToken);
    followerTotal = Number(full.total ?? followerTotal);
    followerAccess.authorized_list_access = true;
    followerAccess.fetched_count = full.followers.length;

    if (publishFollowerNames) {
      followerAccess.latest = full.followers.slice(0, 25).map((f) => ({
        user_id: f.user_id,
        user_login: f.user_login,
        user_name: f.user_name,
        followed_at: f.followed_at,
      }));
    }

    if (publishFullFollowerList) {
      await writeJson(
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
        }
      );
    } else {
      try {
        await fs.unlink(path.join(dataDir, "followers-full.json"));
      } catch {}
    }
  } catch (err) {
    console.warn("Authorized follower-list fetch failed:", err.message);
  }
}

const followerHistory = updateFollowerHistory(
  await readJson("follower-history.json", { days: [] }),
  followerTotal
);

const streamHistory = updateStreamHistory(
  await readJson("stream-history.json", { sessions: [] }),
  stream
);

const gameStats = makeGameStats(streamHistory);

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
  live: Boolean(stream),
  stream: stream
    ? {
        id: stream.id,
        title: stream.title,
        game_id: stream.game_id,
        game_name: stream.game_name,
        viewer_count: stream.viewer_count,
        started_at: stream.started_at,
        language: stream.language,
        tags: stream.tags || [],
        thumbnail_url: stream.thumbnail_url,
      }
    : null,
  followers_total: followerTotal,
};

const followerDays = followerHistory.days || [];
const summary = {
  broadcaster_id: broadcasterId,
  broadcaster_login: broadcasterLogin,
  live: Boolean(stream),
  followers_total: followerTotal,
  follower_change_1d: followerDelta(followerDays, 1),
  follower_change_7d: followerDelta(followerDays, 7),
  follower_change_30d: followerDelta(followerDays, 30),
  tracked_streams: streamHistory.sessions?.length || 0,
  top_games: gameStats.slice(0, 10),
};

const schedule = {
  broadcaster_id: broadcasterId,
  segments: scheduleResult.data?.segments || [],
  vacation: scheduleResult.data?.vacation || null,
};

await Promise.all([
  writeJson("current.json", current),
  writeJson("followers.json", {
    broadcaster_id: broadcasterId,
    broadcaster_login: broadcasterLogin,
    total: followerTotal,
    ...followerAccess,
  }),
  writeJson("follower-history.json", followerHistory),
  writeJson("stream-history.json", streamHistory),
  writeJson("game-stats.json", { games: gameStats }),
  writeJson("videos.json", {
    broadcaster_id: broadcasterId,
    videos: (videosResult.data || []).map(cleanVideo),
  }),
  writeJson("clips.json", {
    broadcaster_id: broadcasterId,
    window_days: 90,
    recent: recentClips,
    top: topClips90d,
  }),
  writeJson("schedule.json", schedule),
  writeJson("summary.json", summary),
]);

console.log(
  JSON.stringify(
    {
      broadcaster: broadcaster.login,
      live: Boolean(stream),
      followers_total: followerTotal,
      authorized_follower_list: followerAccess.authorized_list_access,
      followers_fetched: followerAccess.fetched_count,
      streams_tracked: streamHistory.sessions?.length || 0,
      games_tracked: gameStats.length,
    },
    null,
    2
  )
);
