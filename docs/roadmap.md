# naptek.de Roadmap

Updated: 2026-09-19

## Already set up / active work

- Official Twitch API collection through GitHub Actions.
- Live/offline, title, category, viewers and stream start time.
- Follower total and authorized follower list.
- Follower history, stream history and game/category tracking.
- VODs, clips, Twitch schedule and data validation.
- About / FAQ / PC setup data based on the official Twitch About page.
- `/discord/` short redirect.

## Next website work

- Rebuild **Stats** around the new `data/twitch/` files and safely import useful legacy stats.
- Rebuild **Best of** around current Twitch clips/VOD data.
- Rework **Danke** separately for supporter/community data.
- Merge old and new historical stats without losing already-collected data.
- Continue canonical / sitemap / path cleanup.

## Language / localization

- The website stays German for now.
- Add an English version later with a DE/EN language switcher.
- Shared navigation/common strings should be centralized where practical.
- **Stats, Best of and Danke still need their own localization/UI pass** because they contain page-specific data labels and layouts.

## Backlog

- Third-party historical backfill/scraping such as TwitchTracker, only where official Twitch data and our own stored history have gaps.
- Keep third-party raw captures separate from official Twitch data; parse, normalize and validate before use.
- Combined community stats from Discord and other official sources.
- More milestones and long-term analytics from our own history.
- Shop / merch if real content becomes available.

## Data-source rule

Anything cleanly available from official APIs or naptek.de's own stored history should be implemented directly. Third-party scraping stays optional and must never become the authoritative source for existing Twitch API data.
