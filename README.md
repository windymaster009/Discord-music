# Windy Discord Music

Private Discord music bot for a personal server. Inspired by [Lunox](https://github.com/adh319/Lunox), but simplified for one/few servers instead of a public sharded bot.

## Current features

- `/play` song name, YouTube URL, or Spotify URL
- YouTube / YouTube Music playback through Lavalink
- Spotify track / album / playlist metadata through LavaSrc, mirrored to a playable source
- Modern Now Playing embed with album artwork
- Interactive buttons: previous, pause/resume, skip, loop, shuffle, volume, queue, stop
- `/queue`, `/nowplaying`, `/pause`, `/resume`, `/skip`, `/stop`, `/volume`
- Guild-scoped slash commands when `GUILD_ID` is configured
- Docker stack for bot + Lavalink
- Lavalink 4.2.2 with DAVE support
- Raspberry Pi 4 / ARM64 optimized Docker settings

## Stack

- Node.js 20+
- Discord.js 14
- Rainlink
- Lavalink 4.2.2
- youtube-source plugin 1.18.2
- LavaSrc 4.8.3

## Raspberry Pi 4 target

The official Lavalink 4.2.2 Docker image includes a native `linux/arm64` build, so a 64-bit Raspberry Pi OS installation can run it without x86 emulation.

This repo keeps the Pi deployment lightweight:

- Lavalink Java heap: 64 MB initial / 384 MB maximum
- Lavalink container memory limit: 640 MB
- Node bot heap: 192 MB maximum
- Node bot container memory limit: 256 MB
- No MongoDB
- No Discord sharding
- Dependencies are installed when the bot image is built, not on every reboot

Recommended Pi checks:

```bash
uname -m
```

Expected on a 64-bit Pi OS:

```text
aarch64
```

Check available RAM:

```bash
free -h
```

Watch the containers while testing music:

```bash
docker stats
```

Check Pi temperature/throttling:

```bash
vcgencmd measure_temp
vcgencmd get_throttled
```

## Setup

### 1. Clone

```bash
git clone https://github.com/windymaster009/Discord-music.git
cd Discord-music
git checkout feature/modern-music-bot
```

### 2. Create `.env`

```bash
cp .env.example .env
```

Fill at least:

```env
TOKEN=YOUR_DISCORD_BOT_TOKEN
GUILD_ID=YOUR_PRIVATE_SERVER_ID
SPOTIFY_CLIENT_ID=YOUR_SPOTIFY_APP_CLIENT_ID
SPOTIFY_CLIENT_SECRET=YOUR_SPOTIFY_APP_CLIENT_SECRET
```

`GUILD_ID` is recommended for a private bot because slash-command updates appear in that server immediately.

### 3. Discord bot permissions

Invite the bot with these permissions:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Connect
- Speak
- Use Application Commands

The current bot only needs Guilds + Guild Voice States intents at runtime.

### 4. Start on the Pi

```bash
docker compose up -d --build
```

Watch logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

After code changes:

```bash
git pull
docker compose up -d --build
```

### 5. Test

Join a voice channel and try:

```text
/play query: Never Gonna Give You Up
```

Then test a YouTube URL and a Spotify track/playlist URL.

## Spotify note

Spotify audio is not streamed directly from Spotify. LavaSrc resolves Spotify metadata and mirrors it to a playable source (currently YouTube search providers in `lavalink/application.yml`).

## Project direction

Next UI/features planned:

- Discord Components V2 style player panel
- Dynamic progress bar / elapsed time
- Search result picker
- Queue pagination UI
- Lyrics button
- Audio filters
- Autoplay
- 24/7 mode
- DJ/admin permissions
- Persistent single controller message instead of one message per track

## Attribution

Based on ideas and code patterns from [adh319/Lunox](https://github.com/adh319/Lunox), licensed under MIT. See `LICENSE` and `NOTICE.md`.
