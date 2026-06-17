import {
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { config } from '../config.js';
import { getOrCreateOrder, getOpenOrderByChannel, updateOrder } from '../db/orders.js';
import { getSellerByDiscordId } from '../db/sellers.js';
import { isStaff } from '../lib/permissions.js';
import { brandEmbed } from '../lib/embeds.js';
import { refreshCartMessage } from '../lib/cartView.js';
import { createTranscriptAttachment } from '../lib/transcript.js';

const eph = { flags: MessageFlags.Ephemeral };

export const TICKET_IDS = {
  open: 'open_ticket',
  close: 'close_ticket',
  claim: 'claim_ticket',
};

// Acha o ticket aberto do usuário, ou null.
function findUserTicket(guild, userId) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.topic === `ticket:${userId}`,
  );
}

// Monta o nome do canal a partir do número do pedido (e, depois de assumido,
// do apelido de quem atende). Ex.: "0042" -> "0042-ana".
function ticketChannelName(orderNumber, attendant) {
  const base = String(orderNumber).padStart(4, '0');
  if (!attendant) return base;
  // Discord só aceita letras minúsculas, números e hífens no nome do canal.
  const slug = attendant
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${slug}`.slice(0, 90);
}

// Cria o ticket individual do usuário (ou retorna o existente).
// Posta a mensagem inicial de atendimento + o carrinho. Reutilizável pelo botão
// "Abrir ticket" e pelo "Comprar".
export async function getOrCreateTicketChannel(interaction) {
  const guild = interaction.guild;

  const existing = findUserTicket(guild, interaction.user.id);
  if (existing) return existing;

  const channel = await guild.channels.create({
    name: 'ticket-novo',
    type: ChannelType.GuildText,
    parent: config.discord.ticketCategoryId || undefined,
    topic: `ticket:${interaction.user.id}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: config.discord.staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
    ],
  });

  const welcome = brandEmbed()
    .setTitle('🎫 Atendimento aberto')
    .setDescription(
      [
        `Olá <@${interaction.user.id}>! Bem-vindo ao seu atendimento. 👋`,
        '',
        '**Pra começar, conta pra gente os detalhes do que você quer:**',
        '• Referências / imagens do ped (pode anexar aqui)',
        '• Cores, texturas, detalhes específicos',
        '• Compatibilidade desejada (MP / SP)',
        '• Qualquer observação importante',
        '',
        'A equipe vai te responder por aqui. Quando fechar os detalhes e o valor, ' +
          'use o menu abaixo pra montar o pedido e gerar o Pix.',
      ].join('\n'),
    );

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_IDS.claim)
      .setLabel('Assumir atendimento')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🙋'),
    new ButtonBuilder()
      .setCustomId(TICKET_IDS.close)
      .setLabel('Fechar ticket')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔒'),
  );

  await channel.send({
    content: `<@${interaction.user.id}> <@&${config.discord.staffRoleId}>`,
    embeds: [welcome],
    components: [closeRow],
  });

  // Cria o pedido e renderiza o carrinho já no ticket.
  const order = await getOrCreateOrder({
    discordUserId: interaction.user.id,
    channelId: channel.id,
  });

  // O nome do canal passa a ser o número do pedido (ex.: "0042").
  await channel.setName(ticketChannelName(order.order_number)).catch(() => {});

  await refreshCartMessage(channel, order);

  return channel;
}

// Botão "Abrir ticket" no painel público.
export async function handleOpenTicket(interaction) {
  await interaction.deferReply(eph);
  const existing = findUserTicket(interaction.guild, interaction.user.id);
  const channel = await getOrCreateTicketChannel(interaction);
  await interaction.editReply(
    existing ? `Você já tem um atendimento aberto: ${channel}` : `Atendimento aberto: ${channel}`,
  );
}

// Botão "Assumir atendimento" — a sócia que clicar passa a ser a recebedora do Pix
// deste pedido (grava claimed_by). Só a equipe cadastrada como vendedora pode assumir.
export async function handleClaim(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '⛔ Apenas a equipe pode assumir o atendimento.', ...eph });
  }
  await interaction.deferReply(eph);

  const seller = await getSellerByDiscordId(interaction.user.id);
  if (!seller) {
    return interaction.editReply(
      '⚠️ Você ainda não está cadastrada como vendedora (sem chave Pix). ' +
        'Peça pra incluírem seu Pix na tabela `sellers` antes de assumir.',
    );
  }

  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return interaction.editReply('Nenhum pedido aberto neste ticket.');

  if (order.claimed_by && order.claimed_by !== interaction.user.id) {
    return interaction.editReply(`Este atendimento já foi assumido por <@${order.claimed_by}>.`);
  }

  await updateOrder(order.id, { claimed_by: interaction.user.id });
  await disableClaimButton(interaction.message, seller.name);

  // Renomeia o canal acrescentando o apelido (nunca o usuário) de quem assumiu.
  // Ex.: "0042" -> "0042-ana".
  const apelido = interaction.member?.displayName || seller.name;
  await interaction.channel.setName(ticketChannelName(order.order_number, apelido)).catch(() => {});

  await interaction.channel.send(
    `🙋 <@${interaction.user.id}> assumiu este atendimento.`,
  );
  await interaction.editReply('Você assumiu o atendimento. ✅ Pode gerar o Pix normalmente.');
}

// Desabilita o botão "Assumir" e mostra quem assumiu (mantém o "Fechar ticket").
async function disableClaimButton(message, sellerName) {
  if (!message?.components?.length) return;
  const rows = message.components.map((row) => {
    const r = ActionRowBuilder.from(row);
    r.components.forEach((c) => {
      if (c.data?.custom_id === TICKET_IDS.claim) {
        c.setDisabled(true).setLabel(`Assumido por ${sellerName}`.slice(0, 80));
      }
    });
    return r;
  });
  await message.edit({ components: rows }).catch(() => {});
}

// Extrai o ID do dono do ticket a partir do topic ("ticket:<userId>").
function ticketOwnerId(channel) {
  const m = /^ticket:(\d+)$/.exec(channel.topic || '');
  return m ? m[1] : null;
}

// Gera a transcrição HTML do ticket e posta no canal de logs. Não lança erro:
// se algo falhar, o fechamento segue normalmente (só loga no console).
async function saveTranscript(channel, closedBy) {
  if (!config.discord.transcriptChannelId) return;
  try {
    const logChannel = await channel.guild.channels
      .fetch(config.discord.transcriptChannelId)
      .catch(() => null);
    if (!logChannel) return;

    const { file, count } = await createTranscriptAttachment(channel);
    const ownerId = ticketOwnerId(channel);

    const embed = brandEmbed({ banner: false })
      .setTitle('📄 Transcrição de ticket')
      .addFields(
        { name: 'Canal', value: `#${channel.name}`, inline: true },
        { name: 'Cliente', value: ownerId ? `<@${ownerId}>` : '—', inline: true },
        { name: 'Fechado por', value: `<@${closedBy.id}>`, inline: true },
        { name: 'Mensagens', value: String(count), inline: true },
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed], files: [file] });
  } catch (err) {
    console.error('Falha ao gerar transcrição do ticket:', err);
  }
}

// Botão "Fechar ticket".
export async function handleCloseTicket(interaction) {
  await interaction.reply({ content: 'Gerando transcrição e fechando o ticket em 5s…', ...eph });
  await saveTranscript(interaction.channel, interaction.user);
  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}
