# naptek.de Roadmap

Updated: 2026-11-06

## Already set up / active work

- Official Twitch API collection through GitHub Actions.
- Live/offline, title, category, viewers and stream start time.
- Follower total and authorized follower list.
- Follower history, stream history and game/category tracking.
- VODs, clips, Twitch schedule and data validation.
- About / FAQ / PC setup data based on the official Twitch About page.
- `/discord/` short redirect.

## November 2026 website batch (implemented)

- Homepage social-name easter egg: 3 consistent page-load themes, without normal YouTube/TikTok/Instagram labels. Platform names remain accessible for screen readers.
- **Stats** upgraded to official Twitch follower counts/growth, tracking totals, Twitch category history, stream history, available VODs, and follower charts.
- Historic 2025 game/stream totals kept separately as legacy references, not silently summed with current tracking.
- **Best of** now combines retained official Twitch clip history with older local clips (deduplicated by clip ID); search, game filtering, sorting and pagination.
- **Danke** brought into the shared site design with clear empty-data states; no unsupported claim of automatic subscriber/donation sync.
- Shared mobile styling and navigation for the updated pages.

## Next website work

- Review stream/category recording accuracy, particularly the observed-time estimates during GitHub Actions delays.
- Optional one-time, deduplicated legacy historical backfill with source labels and overlap detection.
- Broader official-source stats: stream-by-stream viewer samples, if retained safely, and milestones.
- Configure genuine broadcaster-authorized supporter data only after obtaining the correct permissions and consent.
- Continue canonical / sitemap / path cleanup and verify deployment on GitHub Pages.
- Build shared German/English localization layer; then translate Stats, Best of and Danke as separate pages.

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
