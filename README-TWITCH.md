# naptek.de Twitch data starter

This bundle is designed for a static GitHub Pages site.

It uses Twitch's official API and GitHub Actions to generate JSON files under:

`data/twitch/`

## What it collects

- Current live/offline state
- Current stream title, category, viewer count and start time
- Channel info
- Follower total
- Full follower-list access when a moderator OAuth refresh token is configured
- Optional latest follower names
- Optional full follower list
- Daily follower count history
- Stream/session history
- Category/game time tracking
- Observed peak viewer count per tracked stream
- Recent VODs
- Recent/top clips from the last 90 days
- Twitch schedule
- A summary JSON for easy website use

## Files

- `.github/workflows/update-twitch.yml`
- `scripts/twitch/auth.mjs`
- `scripts/twitch/update-twitch.mjs`
- `data/twitch/*.json`

## 1. Register a Twitch app

Create/manage a Twitch Developer application and register this redirect URL:

`http://localhost:3000/callback`

Copy the app's Client ID and create a Client Secret.

## 2. Add GitHub Actions secrets

Repository -> Settings -> Secrets and variables -> Actions -> Secrets

Add:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`

For moderator follower-list access, also add:

- `TWITCH_USER_REFRESH_TOKEN`
- `GH_SECRETS_PAT`

`GH_SECRETS_PAT` should be a fine-grained GitHub token limited to THIS repository,
with Repository permission:

- Secrets: Read and write

It is only used so the workflow can safely replace `TWITCH_USER_REFRESH_TOKEN`
if Twitch rotates the refresh token.

## 3. Add GitHub Actions variables

Repository -> Settings -> Secrets and variables -> Actions -> Variables

Add:

- `TWITCH_BROADCASTER_LOGIN` = the broadcaster's Twitch login
- `PUBLISH_FOLLOWER_NAMES` = `false` or `true`
- `PUBLISH_FULL_FOLLOWER_LIST` = `false` or `true`

Recommended defaults:

- `PUBLISH_FOLLOWER_NAMES=false`
- `PUBLISH_FULL_FOLLOWER_LIST=false`

The follower list requires moderator authorization even when names are not published.

## 4. Authorize the moderator account once

On your own PC, from the repository root:

PowerShell:

```powershell
$env:TWITCH_CLIENT_ID="your-client-id"
$env:TWITCH_CLIENT_SECRET="your-client-secret"
node scripts/twitch/auth.mjs
```

Open the URL printed by the script and authorize using the Twitch account that is
a moderator for the broadcaster.

The helper writes:

`.twitch-user-token.json`

DO NOT commit that file.

Copy the `refresh_token` value into the GitHub secret:

`TWITCH_USER_REFRESH_TOKEN`

Then delete the local token file when you no longer need it.

## 5. Add this to `.gitignore`

```gitignore
.twitch-user-token.json
```

## 6. Run it

GitHub -> Actions -> Update Twitch data -> Run workflow

After a successful run, JSON files under `data/twitch/` will be populated.

The workflow also runs every 15 minutes.

## Notes

Game/category time is observed time. Since the workflow checks periodically,
category changes and stream endings can be off by up to roughly one workflow interval.

Follower 1/7/30-day changes need enough local history before those values become available.
