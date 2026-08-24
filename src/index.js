require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");
const { Rainlink, Library } = require("rainlink");
const { VoicePlugin } = require("rainlink-voice");
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
client.rainlink = new Rainlink({
  nodes: config.rainlinkNodes,
  library: new Library.DiscordJS(client),
  plugins: [new VoicePlugin()],
  options: config.rainlinkOptions,
});

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
  return client.rainlink.players.get(guildId);
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
  return client.rainlink.create({
    guildId: guild.id,
    textId: channelId,
    voiceId: voice.id,
    shardId: guild.shardId,
    volume: config.defaultVolume,
    deaf: true,
  });
}

function addSearchResult(player, result) {
  if (result.type === "PLAYLIST") {
    for (const track of result.tracks) player.queue.add(track);
    return `Added **${result.playlistName || "playlist"}** — ${result.tracks.length} songs 🎶`;
  }

  const track = result.tracks[0];
  player.queue.add(track);
  return `Added **${track.title}** — ${track.author} 🎵`;
}

async function searchMusic(query, requester) {
  return client.rainlink.search(query, {
    requester,
    sourceID: config.lavalinkSource,
  });
}

async function play(interaction) {
  let player = getPlayerByGuildId(interaction.guildId);
  const voice = await requireSameVoiceInteraction(interaction, player);
  if (!voice) return;

  const query = interaction.options.getString("query", true);
  await interaction.deferReply();

  const result = await searchMusic(query, interaction.member);

  if (!result?.tracks?.length || result.type === "EMPTY" || result.type === "ERROR") {
    return interaction.editReply("I couldn't find anything for that query.");
  }

  if (!player) player = await createPlayer(interaction.guild, interaction.channelId, voice);

  const response = addSearchResult(player, result);
  await interaction.editReply(response);

  if (!player.playing) await player.play();
}

async function playMessage(message, query) {
  let player = getPlayerByGuildId(message.guildId);
  const voice = await requireSameVoiceMessage(message, player);
  if (!voice) return;

  if (!query) {
    return message.reply(`Usage: \`${config.prefix}p <song or URL>\` or \`${config.prefix}play <song or URL>\``);
  }

  const status = await message.reply(`Searching for **${query}** 🔎`);

  try {
    const result = await searchMusic(query, message.member);

    if (!result?.tracks?.length || result.type === "EMPTY" || result.type === "ERROR") {
      return status.edit("I couldn't find anything for that query.");
    }

    if (!player) player = await createPlayer(message.guild, message.channelId, voice);

    const response = addSearchResult(player, result);
    await status.edit(response);

    if (!player.playing) await player.play();
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
    await player.pause();
    return interaction.reply({ content: "Paused ⏸️", flags: MessageFlags.Ephemeral });
  }
  if (action === "resume") {
    await player.resume();
    return interaction.reply({ content: "Resumed ▶️", flags: MessageFlags.Ephemeral });
  }
  if (action === "skip") {
    if (player.queue.isEmpty) {
      return interaction.reply({ content: "There isn't another song in the queue.", flags: MessageFlags.Ephemeral });
    }
    await player.skip();
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
    return message.reply(`🎵 **${player.queue.current.title}** — ${player.queue.current.author}`);
  }

  if (!player?.queue?.current && !["stop", "leave"].includes(command)) {
    return message.reply("Nothing is playing right now.");
  }

  const voice = await requireSameVoiceMessage(message, player);
  if (!voice) return;

  if (command === "pause") {
    await player.pause();
    return message.reply("Paused ⏸️");
  }

  if (command === "resume") {
    await player.resume();
    return message.reply("Resumed ▶️");
  }

  if (["skip", "s"].includes(command)) {
    if (player.queue.isEmpty) return message.reply("There isn't another song in the queue.");
    await player.skip();
    return message.reply("Skipped ⏭️");
  }

  if (["stop", "leave"].includes(command)) {
    if (!player) return message.reply("I'm not connected right now.");
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

client.rainlink.on("nodeConnect", (node) => console.log(`Lavalink ${node.options.name}: connected`));
client.rainlink.on("nodeError", (node, error) => console.error(`Lavalink ${node.options.name}:`, error));
client.rainlink.on("nodeDisconnect", (node, code, reason) =>
  console.warn(`Lavalink ${node.options.name}: disconnected (${code}) ${reason || ""}`),
);
client.rainlink.on("trackStart", (player, track) => sendPlayerController(client, player, track));

// Rainlink can emit queueEmpty as part of a failed-track transition. Only announce it
// when there is truly no current track and nothing left to play.
client.rainlink.on("queueEmpty", (player) => {
  if (player.queue?.current || !player.queue?.isEmpty) {
    console.warn(`[Queue:${player.guildId}] transient queueEmpty ignored; another track is still available.`);
    return;
  }

  const channel = client.channels.cache.get(player.textId);
  if (channel) channel.send(`Queue finished. Add another song with \`${config.prefix}p\` or \`/play\` 🎶`).catch(() => null);
});

// Playback diagnostics: these are intentionally noisy while we debug the rapid-skip issue.
client.rainlink.on("playerException", (player, data) => {
  console.error(`[PlaybackException:${player.guildId}]`, JSON.stringify(data, null, 2));
});
client.rainlink.on("trackStuck", (player, data) => {
  console.error(`[TrackStuck:${player.guildId}]`, JSON.stringify(data, null, 2));
});
client.rainlink.on("trackResolveError", (player, track, error) => {
  console.error(`[TrackResolveError:${player.guildId}] ${track?.title || "Unknown track"}:`, error);
});
client.rainlink.on("playerWebsocketClosed", (player, data) => {
  console.error(`[VoiceWebsocketClosed:${player.guildId}]`, JSON.stringify(data, null, 2));
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
    if (interaction.commandName === "play") return play(interaction);

    const player = getPlayerByGuildId(interaction.guildId);

    if (interaction.commandName === "pause") return simplePlayerAction(interaction, "pause");
    if (interaction.commandName === "resume") return simplePlayerAction(interaction, "resume");
    if (interaction.commandName === "skip") return simplePlayerAction(interaction, "skip");

    if (interaction.commandName === "queue") {
      if (!player?.queue?.current) {
        return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: `**Now:** ${player.queue.current.title}\n\n**Up next**\n${queueText(player)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "nowplaying") {
      if (!player?.queue?.current) {
        return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: `🎵 **${player.queue.current.title}** — ${player.queue.current.author}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "volume") {
      if (!player?.queue?.current) {
        return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
      }
      const voice = await requireSameVoiceInteraction(interaction, player);
      if (!voice) return;
      const requested = interaction.options.getInteger("percent", true);
      const volume = Math.max(config.minVolume, Math.min(config.maxVolume, requested));
      await player.setVolume(volume);
      return interaction.reply({ content: `Volume set to **${volume}%** 🔊`, flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === "stop") {
      if (!player) {
        return interaction.reply({ content: "I'm not connected right now.", flags: MessageFlags.Ephemeral });
      }
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
