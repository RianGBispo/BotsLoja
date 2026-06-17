import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config } from './config.js';
import { routeInteraction } from './interactions/router.js';
import { welcomeEmbed } from './lib/embeds.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Necessários para capturar o comprovante/arquivo enviado após clicar nos botões
    // (message collector). MessageContent é privilegiado: ative-o no Developer Portal.
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    // Necessário para o evento de boas-vindas (GuildMemberAdd). É um intent
    // PRIVILEGIADO: ative "Server Members Intent" no Developer Portal.
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot online como ${c.user.tag}`);
});

client.on(Events.InteractionCreate, routeInteraction);

// Boas-vindas: posta um card quando alguém entra no servidor.
client.on(Events.GuildMemberAdd, async (member) => {
  const channelId = config.discord.welcomeChannelId;
  if (!channelId) return; // desativado se WELCOME_CHANNEL_ID estiver vazio
  try {
    const channel = await member.client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    await channel.send({ content: `<@${member.id}>`, embeds: [welcomeEmbed(member)] });
  } catch (e) {
    console.error('Falha ao enviar mensagem de boas-vindas:', e);
  }
});

client.login(config.discord.token);

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
