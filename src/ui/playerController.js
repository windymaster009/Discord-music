const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

function formatTime(ms = 0) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function queueText(player) {
  if (!player?.queue || player.queue.isEmpty) return "Queue is empty.";
  return player.queue
    .slice(0, 10)
    .map((track, index) => `${index + 1}. **${track.title}** — ${track.author || "Unknown"}`)
    .join("\n");
}

function buildController(client, player, track) {
  const duration = track.isStream ? "LIVE" : formatTime(track.length);
  const requesterId = track.requester?.id || track.requester?.user?.id;
  const requester = requesterId ? `<@${requesterId}>` : "Unknown";

  const embed = new EmbedBuilder()
    .setColor(client.config.embedColor)
    .setAuthor({
      name: player.paused ? "Paused" : "Now Playing",
      iconURL: client.user.displayAvatarURL(),
    })
    .setTitle(track.title || "Unknown track")
    .setURL(track.uri || null)
    .setDescription(`**${track.author || "Unknown artist"}**`)
    .setThumbnail(track.thumbnail || null)
    .addFields(
      { name: "Duration", value: `\`${duration}\``, inline: true },
      { name: "Volume", value: `\`${player.volume}%\``, inline: true },
      { name: "Loop", value: `\`${player.loop || "none"}\``, inline: true },
      { name: "Requested by", value: requester, inline: true },
      { name: "Source", value: `\`${track.sourceName || "unknown"}\``, inline: true },
      { name: "Up next", value: `\`${player.queue?.size || 0} song(s)\``, inline: true },
    )
    .setFooter({ text: "Windy Music • YouTube + Spotify" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music:prev").setEmoji("⏮️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music:pause")
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music:skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:loop").setEmoji("🔁").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music:voldown").setEmoji("🔉").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:queue").setLabel("Queue").setEmoji("📜").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:volup").setEmoji("🔊").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:stop").setLabel("Stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
  );

  return { embed, rows: [row1, row2] };
}

async function sendPlayerController(client, player, track) {
  if (!player) return;

  const previousCollector = player.data.get("controllerCollector");
  if (previousCollector) previousCollector.stop("track-change");

  const channel = client.channels.cache.get(player.textId);
  if (!channel) return;

  const { embed, rows } = buildController(client, player, track);
  const message = await channel.send({ embeds: [embed], components: rows });
  player.data.set("controllerMessage", message);

  const collector = message.createMessageComponentCollector();
  player.data.set("controllerCollector", collector);

  collector.on("collect", async (interaction) => {
    const currentPlayer = client.kazagumo.players.get(player.guildId);
    if (!currentPlayer) return collector.stop("player-gone");

    if (!interaction.member.voice.channel || currentPlayer.voiceId !== interaction.member.voice.channelId) {
      return interaction.reply({
        content: "Join the same voice channel as the bot first.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    switch (interaction.customId) {
      case "music:pause":
        await interaction.deferUpdate();
        currentPlayer.pause(!currentPlayer.paused);
        break;

      case "music:prev": {
        const previous = currentPlayer.getPrevious(true);
        if (!previous) return reply("There is no previous track.");
        await interaction.deferUpdate();
        await currentPlayer.play(previous);
        return;
      }

      case "music:skip":
        if (currentPlayer.queue.isEmpty) return reply("Nothing else is queued.");
        await interaction.deferUpdate();
        currentPlayer.skip();
        return;

      case "music:loop":
        if (currentPlayer.loop === "none") currentPlayer.setLoop("track");
        else if (currentPlayer.loop === "track") currentPlayer.setLoop("queue");
        else currentPlayer.setLoop("none");
        return reply(`Loop mode: **${currentPlayer.loop}**`);

      case "music:shuffle":
        if (currentPlayer.queue.isEmpty) return reply("Queue is empty.");
        currentPlayer.queue.shuffle();
        return reply("Queue shuffled 🔀");

      case "music:voldown": {
        const next = Math.max(client.config.minVolume, currentPlayer.volume - 10);
        await currentPlayer.setVolume(next);
        return reply(`Volume: **${next}%**`);
      }

      case "music:volup": {
        const next = Math.min(client.config.maxVolume, currentPlayer.volume + 10);
        await currentPlayer.setVolume(next);
        return reply(`Volume: **${next}%**`);
      }

      case "music:queue":
        return reply(queueText(currentPlayer));

      case "music:stop":
        await interaction.deferUpdate();
        await currentPlayer.destroy();
        return;
    }

    const currentTrack = currentPlayer.queue.current || track;
    const updated = buildController(client, currentPlayer, currentTrack);
    await message.edit({ embeds: [updated.embed], components: updated.rows }).catch(() => null);
  });
}

module.exports = { sendPlayerController, queueText, formatTime };
