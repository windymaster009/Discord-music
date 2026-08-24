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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
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

function getVoiceChannel(interaction) {
  return interaction.member?.voice?.channel || null;
}

function getPlayer(interaction) {
  return client.rainlink.players.get(interaction.guildId);
}

async function requireSameVoice(interaction, player) {
  const voice = getVoiceChannel(interaction);
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

async function play(interaction) {
  let player = getPlayer(interaction);
  const voice = await requireSameVoice(interaction, player);
  if (!voice) return;

  const query = interaction.options.getString("query", true);
  await interaction.deferReply();

  const result = await client.rainlink.search(query, {
    requester: interaction.member,
    sourceID: config.lavalinkSource,
  });

  if (!result?.tracks?.length || result.type === "EMPTY" || result.type === "ERROR") {
    return interaction.editReply("I couldn't find anything for that query.");
  }

  if (!player) {
    player = await client.rainlink.create({
      guildId: interaction.guildId,
      textId: interaction.channelId,
      voiceId: voice.id,
      shardId: interaction.guild.shardId,
      volume: config.defaultVolume,
      deaf: true,
    });
  }

  if (result.type === "PLAYLIST") {
    for (const track of result.tracks) player.queue.add(track);
    await interaction.editReply(`Added **${result.playlistName || "playlist"}** — ${result.tracks.length} songs 🎶`);
  } else {
    const track = result.tracks[0];
    player.queue.add(track);
    await interaction.editReply(`Added **${track.title}** — ${track.author} 🎵`);
  }

  if (!player.playing) player.play();
}

async function simplePlayerAction(interaction, action) {
  const player = getPlayer(interaction);
  if (!player?.queue?.current) {
    return interaction.reply({ content: "Nothing is playing right now.", flags: MessageFlags.Ephemeral });
  }

  const voice = await requireSameVoice(interaction, player);
  if (!voice) return;

  if (action === "pause") {
    player.pause();
    return interaction.reply({ content: "Paused ⏸️", flags: MessageFlags.Ephemeral });
  }
  if (action === "resume") {
    player.resume();
    return interaction.reply({ content: "Resumed ▶️", flags: MessageFlags.Ephemeral });
  }
  if (action === "skip") {
    if (player.queue.isEmpty) {
      return interaction.reply({ content: "There isn't another song in the queue.", flags: MessageFlags.Ephemeral });
    }
    player.skip();
    return interaction.reply({ content: "Skipped ⏭️", flags: MessageFlags.Ephemeral });
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

  readyClient.user.setPresence({ activities: [{ name: "/play • Windy Music" }], status: "online" });
  console.log(`${readyClient.user.tag} is ready`);
});

client.rainlink.on("nodeConnect", (node) => console.log(`Lavalink ${node.options.name}: connected`));
client.rainlink.on("nodeError", (node, error) => console.error(`Lavalink ${node.options.name}:`, error));
client.rainlink.on("nodeDisconnect", (node, code, reason) =>
  console.warn(`Lavalink ${node.options.name}: disconnected (${code}) ${reason || ""}`),
);
client.rainlink.on("trackStart", (player, track) => sendPlayerController(client, player, track));
client.rainlink.on("queueEmpty", (player) => {
  const channel = client.channels.cache.get(player.textId);
  if (channel) channel.send("Queue finished. Add another song with `/play` 🎶").catch(() => null);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  try {
    if (interaction.commandName === "play") return play(interaction);

    const player = getPlayer(interaction);

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
      const voice = await requireSameVoice(interaction, player);
      if (!voice) return;
      const requested = interaction.options.getInteger("percent", true);
      const volume = Math.max(config.minVolume, Math.min(config.maxVolume, requested));
      player.setVolume(volume);
      return interaction.reply({ content: `Volume set to **${volume}%** 🔊`, flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === "stop") {
      if (!player) {
        return interaction.reply({ content: "I'm not connected right now.", flags: MessageFlags.Ephemeral });
      }
      const voice = await requireSameVoice(interaction, player);
      if (!voice) return;
      player.destroy();
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
