require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");
const { Connectors } = require("shoukaku");
const { Kazagumo } = require("kazagumo");
const config = require("./config");
const { sendPlayerController, queueText } = require("./ui/playerController");

if (!config.token) {
  console.error("Missing TOKEN in .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.config = config;
client.kazagumo = new Kazagumo(
  {
    defaultSearchEngine: config.defaultSearchEngine,
    send: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
  },
  new Connectors.DiscordJS(client),
  config.lavalinkNodes,
  {
    resume: true,
    resumeTimeout: 30,
    reconnectTries: 5,
    reconnectInterval: 5,
  },
);

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube, Spotify, or search")
    .addStringOption((option) =>
      option.setName("query").setDescription("Song name, YouTube URL, or Spotify URL").setRequired(true),
    ),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current song"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the next songs"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the current song"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume the current song"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop music and disconnect"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Change player volume")
    .addIntegerOption((option) =>
      option.setName("percent").setDescription("Volume from 10 to 100").setMinValue(10).setMaxValue(100).setRequired(true),
    ),
].map((command) => command.toJSON());

function getPlayerByGuildId(guildId) {
  return client.kazagumo.players.get(guildId);
}

function getVoiceChannel(member) {
  return member?.voice?.channel || null;
}

async function requireSameVoiceInteraction(interaction, player) {
  const voice = getVoiceChannel(interaction.member);
  if (!voice) {
    await interaction.reply({ content: "Join a voice channel first 🎧", flags: MessageFlags.Ephemeral });
    return null;
  }
  if (player && player.voiceId !== voice.id) {
    await interaction.reply({ content: "Join the same voice channel as the bot first.", flags: MessageFlags.Ephemeral });
    return null;
  }
  return voice;
}

async function requireSameVoiceMessage(message, player) {
  const voice = getVoiceChannel(message.member);
  if (!voice) {
    await message.reply("Join a voice channel first 🎧");
    return null;
  }
  if (player && player.voiceId !== voice.id) {
    await message.reply("Join the same voice channel as the bot first.");
    return null;
  }
  return voice;
}

async function createPlayer(guild, channelId, voice) {
  return client.kazagumo.createPlayer({
    guildId: guild.id,
    textId: channelId,
    voiceId: voice.id,
    volume: config.defaultVolume,
    deaf: true,
  });
}

function addSearchResult(player, result) {
  if (result.type === "PLAYLIST") {
    player.queue.add(result.tracks);
    return `Added **${result.playlistName || "playlist"}** — ${result.tracks.length} songs 🎶`;
  }

  const track = result.tracks[0];
  player.queue.add(track);
  return `Added **${track.title}** — ${track.author || "Unknown"} 🎵`;
}

async function searchMusic(query, requester) {
  return client.kazagumo.search(query, { requester });
}

async function startPlayback(player) {
  if (!player.playing && !player.paused) await player.play();
}

async function playInteraction(interaction) {
  let player = getPlayerByGuildId(interaction.guildId);
  const voice = await requireSameVoiceInteraction(interaction, player);
  if (!voice) return;

  const query = interaction.options.getString("query", true);
  await interaction.deferReply();

  const result = await searchMusic(query, interaction.member);
  if (!result?.tracks?.length) return interaction.editReply("I couldn't find anything for that query.");

  if (!player) player = await createPlayer(interaction.guild, interaction.channelId, voice);
  const response = addSearchResult(player, result);
  await interaction.editReply(response);
  await startPlayback(player);
}

async function playMessage(message, query) {
  let player = getPlayerByGuildId(message.guildId);
  const voice = await requireSameVoiceMessage(message, player);
  if (!voice) return;

  if (!query) return message.reply(`Usage: \`${config.prefix}p <song or URL>\` or \`${config.prefix}play <song or URL>\``);

  const status = await message.reply(`Searching for **${query}** 🔎`);
  try {
    const result = await searchMusic(query, message.member);
    if (!result?.tracks?.length) return status.edit("I couldn't find anything for that query.");

    if (!player) player = await createPlayer(message.guild, message.channelId, voice);
    const response = addSearchResult(player, result);
    await status.edit(response);
    await startPlayback(player);
  } catch (error) {
    console.error(`[Prefix ${config.prefix}play] failed:`, error);
    await status.edit("Something went wrong while trying to play that song.").catch(() => null);
  }
}

async function simplePlayerAction(interaction, action) {
  const player = getPlayerByGuildId(interaction.guildId);
  if (!player?.queue?.current) {
    return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
  }
  const voice = await requireSameVoiceInteraction(interaction, player);
  if (!voice) return;

  if (action === "pause") {
    player.pause(true);
    return interaction.reply({ content: "Paused ⏸️", flags: MessageFlags.Ephemeral });
  }
  if (action === "resume") {
    player.pause(false);
    return interaction.reply({ content: "Resumed ▶️", flags: MessageFlags.Ephemeral });
  }
  if (action === "skip") {
    if (player.queue.isEmpty) return interaction.reply({ content: "There isn't another song in the queue.", flags: MessageFlags.Ephemeral });
    player.skip();
    return interaction.reply({ content: "Skipped ⏭️", flags: MessageFlags.Ephemeral });
  }
}

async function prefixPlayerAction(message, command, args) {
  const player = getPlayerByGuildId(message.guildId);

  if (["queue", "q", "nowplaying", "np"].includes(command)) {
    if (!player?.queue?.current) return message.reply("Nothing is playing right now.");
    if (["queue", "q"].includes(command)) {
      return message.reply(`**Now:** ${player.queue.current.title}\n\n**Up next**\n${queueText(player)}`);
    }
    return message.reply(`🎵 **${player.queue.current.title}** — ${player.queue.current.author || "Unknown"}`);
  }

  if (!player && ["stop", "leave"].includes(command)) return message.reply("I'm not connected right now.");
  if (!player?.queue?.current) return message.reply("Nothing is playing right now.");

  const voice = await requireSameVoiceMessage(message, player);
  if (!voice) return;

  if (command === "pause") {
    player.pause(true);
    return message.reply("Paused ⏸️");
  }
  if (command === "resume") {
    player.pause(false);
    return message.reply("Resumed ▶️");
  }
  if (["skip", "s"].includes(command)) {
    if (player.queue.isEmpty) return message.reply("There isn't another song in the queue.");
    player.skip();
    return message.reply("Skipped ⏭️");
  }
  if (["stop", "leave"].includes(command)) {
    await player.destroy();
    return message.reply("Stopped and disconnected 👋");
  }
  if (["volume", "vol"].includes(command)) {
    const requested = Number(args[0]);
    if (!Number.isFinite(requested)) return message.reply(`Usage: \`${config.prefix}volume 10-100\``);
    const volume = Math.max(config.minVolume, Math.min(config.maxVolume, requested));
    await player.setVolume(volume);
    return message.reply(`Volume set to **${volume}%** 🔊`);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    if (config.guildId) {
      const guild = await readyClient.guilds.fetch(config.guildId);
      await guild.commands.set(commands);
      console.log(`Registered ${commands.length} commands in ${guild.name}`);
    } else {
      await readyClient.application.commands.set(commands);
      console.log(`Registered ${commands.length} global commands`);
    }
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }

  readyClient.user.setPresence({ activities: [{ name: `${config.prefix}p • /play • Windy Music` }], status: "online" });
  console.log(`${readyClient.user.tag} is ready | Prefix: ${config.prefix}`);
});

client.kazagumo.shoukaku.on("ready", (name) => console.log(`Lavalink ${name}: ready (Shoukaku/DAVE)`));
client.kazagumo.shoukaku.on("error", (name, error) => console.error(`Lavalink ${name}:`, error));
client.kazagumo.shoukaku.on("close", (name, code, reason) => console.warn(`Lavalink ${name}: closed (${code}) ${reason || ""}`));
client.kazagumo.shoukaku.on("disconnect", (name, count) => console.warn(`Lavalink ${name}: disconnected; ${count} player(s) affected`));

client.kazagumo.on("playerStart", (player, track) => {
  console.log(`[PlayerStart:${player.guildId}] ${track.title}`);
  sendPlayerController(client, player, track).catch((error) => console.error("Controller error:", error));
});
client.kazagumo.on("playerEnd", (player, track) => {
  console.log(`[PlayerEnd:${player.guildId}] ${track?.title || "unknown"}`);
});
client.kazagumo.on("playerEmpty", async (player) => {
  const channel = client.channels.cache.get(player.textId);
  if (channel) await channel.send(`Queue finished. Add another song with \`${config.prefix}p\` or \`/play\` 🎶`).catch(() => null);
  await player.destroy().catch(() => null);
});
client.kazagumo.on("playerException", (player, data) => {
  console.error(`[PlaybackException:${player.guildId}]`, JSON.stringify(data, null, 2));
});
client.kazagumo.on("playerStuck", (player, data) => {
  console.error(`[TrackStuck:${player.guildId}]`, JSON.stringify(data, null, 2));
});
client.kazagumo.on("playerResolveError", (player, track, error) => {
  console.error(`[TrackResolveError:${player.guildId}] ${track?.title || "Unknown"}:`, error);
});
client.kazagumo.on("playerClosed", (player, data) => {
  console.error(`[VoiceClosed:${player.guildId}]`, JSON.stringify(data, null, 2));
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(config.prefix)) return;

  const body = message.content.slice(config.prefix.length).trim();
  if (!body) return;
  const [rawCommand, ...args] = body.split(/\s+/);
  const command = rawCommand.toLowerCase();

  if (["p", "play"].includes(command)) return playMessage(message, args.join(" "));
  if (["pause", "resume", "skip", "s", "stop", "leave", "queue", "q", "nowplaying", "np", "volume", "vol"].includes(command)) {
    try {
      return await prefixPlayerAction(message, command, args);
    } catch (error) {
      console.error(`[Prefix ${config.prefix}${command}] failed:`, error);
      return message.reply("Something went wrong while handling that command.").catch(() => null);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  try {
    if (interaction.commandName === "play") return playInteraction(interaction);
    const player = getPlayerByGuildId(interaction.guildId);

    if (interaction.commandName === "pause") return simplePlayerAction(interaction, "pause");
    if (interaction.commandName === "resume") return simplePlayerAction(interaction, "resume");
    if (interaction.commandName === "skip") return simplePlayerAction(interaction, "skip");

    if (interaction.commandName === "queue") {
      if (!player?.queue?.current) return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: `**Now:** ${player.queue.current.title}\n\n**Up next**\n${queueText(player)}`, flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === "nowplaying") {
      if (!player?.queue?.current) return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: `🎵 **${player.queue.current.title}** — ${player.queue.current.author || "Unknown"}`, flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === "volume") {
      if (!player?.queue?.current) return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
      const voice = await requireSameVoiceInteraction(interaction, player);
      if (!voice) return;
      const requested = interaction.options.getInteger("percent", true);
      const volume = Math.max(config.minVolume, Math.min(config.maxVolume, requested));
      await player.setVolume(volume);
      return interaction.reply({ content: `Volume set to **${volume}%** 🔊`, flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === "stop") {
      if (!player) return interaction.reply({ content: "I'm not connected right now.", flags: MessageFlags.Ephemeral });
      const voice = await requireSameVoiceInteraction(interaction, player);
      if (!voice) return;
      await player.destroy();
      return interaction.reply({ content: "Stopped and disconnected 👋", flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    const content = "Something went wrong while handling that command.";
    if (interaction.deferred || interaction.replied) return interaction.editReply(content).catch(() => null);
    return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
});

client.login(config.token);
