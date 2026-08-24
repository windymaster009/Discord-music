const parseBoolean = (value) => String(value).trim().toLowerCase() === "true";

module.exports = {
  token: process.env.TOKEN,
  guildId: process.env.GUILD_ID || null,
  prefix: process.env.PREFIX || ".",
  embedColor: process.env.EMBED_COLOR || "5865F2",
  defaultVolume: Number(process.env.DEFAULT_VOLUME || 60),
  minVolume: Number(process.env.MIN_VOLUME || 10),
  maxVolume: Number(process.env.MAX_VOLUME || 100),
  lavalinkSource: process.env.LAVALINK_SOURCE || "ytm",
  rainlinkOptions: {
    resume: true,
    resumeTimeout: 5000,
    retryTimeout: 5000,
    retryCount: Infinity,
    defaultSearchEngine: process.env.DEFAULT_SEARCH_ENGINE || "youtubeMusic",
    searchFallback: {
      enable: true,
      engine: process.env.SEARCH_FALLBACK_ENGINE || "youtube",
    },
  },
  rainlinkNodes: [
    {
      name: process.env.LAVALINK_NAME || "WindyMusic",
      host: process.env.LAVALINK_HOST || "localhost",
      port: Number(process.env.LAVALINK_PORT || 2333),
      auth: process.env.LAVALINK_PASSWORD || "youshallnotpass",
      secure: parseBoolean(process.env.LAVALINK_SECURE || false),
      driver: process.env.LAVALINK_DRIVER || "lavalink/v4/koinu",
    },
  ],
};
