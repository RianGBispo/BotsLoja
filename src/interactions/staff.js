import {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { getOrder, getOrderItems, updateOrder } from '../db/orders.js';
import { getSellerByDiscordId } from '../db/sellers.js';
import { gerarPixCopiaECola } from '../lib/pix.js';
import { saleEmbed, brl } from '../lib/embeds.js';
import { isStaff } from '../lib/permissions.js';
import { IDS, staffActionsRow } from '../lib/components.js';
import { config } from '../config.js';

const eph = { flags: MessageFlags.Ephemeral };

function ensureStaff(interaction) {
  if (isStaff(interaction.member)) return true;
  interaction.reply({ content: '⛔ Apenas a equipe pode usar este botão.', ...eph });
  return false;
}

// Botão "Copiar Pix" — reenvia o copia e cola em texto puro (efêmero).
export async function handleCopyPix(interaction, orderId) {
  await interaction.deferReply(eph);
  const order = await getOrder(orderId);
  const seller = await getSellerByDiscordId(order.claimed_by);
  if (!seller) {
    return interaction.editReply('Pix indisponível: ninguém assumiu este atendimento ainda.');
  }
  const copiaECola = gerarPixCopiaECola({
    key: seller.pix_key,
    amount: order.total,
    merchantName: seller.merchant_name,
    merchantCity: seller.merchant_city,
    txid: order.pix_txid,
  });
  await interaction.editReply(`\`\`\`\n${copiaECola}\n\`\`\``);
}

// Botão "Já paguei" (cliente) — marca para revisão e chama a equipe pra conferir o comprovante.
export async function handlePaidClaim(interaction, orderId) {
  const order = await getOrder(orderId);

  // Só o comprador (ou a equipe) pode usar.
  if (interaction.user.id !== order.discord_user_id && !isStaff(interaction.member)) {
    return interaction.reply({ content: '⛔ Apenas o cliente do pedido pode usar este botão.', ...eph });
  }

  await interaction.deferReply(eph);

  if (order.status === 'paid' || order.status === 'delivered') {
    return interaction.editReply('Este pedido já foi confirmado pela equipe. 👍');
  }

  // Pede o comprovante AGORA e captura o próximo anexo que o cliente enviar — assim não
  // confundimos com imagens de referência ou outras mensagens antigas do ticket.
  await interaction.editReply(
    '📎 Envie agora o **comprovante** (imagem ou PDF) aqui no chat. Você tem 2 minutos. ⏳',
  );

  const isProof = (a) => {
    const type = a.contentType || '';
    const name = (a.name || '').toLowerCase();
    return type.startsWith('image/') || type === 'application/pdf' || name.endsWith('.pdf');
  };

  const proof = await awaitAttachment(interaction.channel, order.discord_user_id, { validate: isProof });
  if (!proof) {
    return interaction.followUp({
      content:
        '⏰ Não recebi o comprovante a tempo. Clique em **"Já paguei"** novamente e ' +
        'envie a imagem/PDF logo em seguida.',
      ...eph,
    });
  }

  await updateOrder(orderId, { status: 'awaiting_review' });

  await interaction.channel.send({
    content:
      `<@&${config.discord.staffRoleId}> 💸 <@${order.discord_user_id}> enviou o comprovante do ` +
      `**Pedido #${String(order.order_number).padStart(4, '0')}** (${brl(order.total)}).\n` +
      `Confiram o **comprovante** ([ver](${proof.url})) e validem abaixo:`,
    components: [staffActionsRow(orderId)],
  });

  await interaction.followUp({
    content: 'Comprovante recebido e equipe avisada! ✅ Em breve validamos.',
    ...eph,
  });
}

// Botão "Aprovar" — pede o(s) arquivo(s) à equipe e só então marca como pago e avisa o cliente.
export async function handleApprove(interaction, orderId) {
  if (!ensureStaff(interaction)) return;
  await interaction.deferReply(eph);

  const order = await getOrder(orderId);
  if (order.status === 'delivered' || order.status === 'paid') {
    return interaction.editReply('Este pedido já foi aprovado.');
  }

  const items = await getOrderItems(orderId);
  const itemLines = items.map((i) => `• ${i.product.name}`).join('\n');

  // Pede o(s) arquivo(s) AGORA e captura o próximo anexo que esta pessoa da equipe enviar.
  await interaction.editReply(
    `📎 Envie agora aqui no chat o(s) **arquivo(s)** deste pedido (você tem 2 minutos ⏳):\n${itemLines}`,
  );

  const delivery = await awaitAttachment(interaction.channel, interaction.user.id);
  if (!delivery) {
    return interaction.followUp({
      content:
        '⏰ Não recebi o arquivo a tempo. Clique em **"Aprovar"** novamente e ' +
        'envie o(s) arquivo(s) logo em seguida.',
      ...eph,
    });
  }

  await updateOrder(orderId, { status: 'paid', approved_by: interaction.user.id });

  // Avisa o cliente que o pagamento foi confirmado e o arquivo já foi enviado.
  await interaction.channel.send({
    content:
      `<@${order.discord_user_id}> ✅ Pagamento confirmado! O(s) arquivo(s) do seu pedido ` +
      `foram enviados acima. Bom uso! 🎉`,
  });

  // Registra a venda no canal #vendas (se configurado).
  if (config.discord.salesChannelId) {
    const ch = await interaction.client.channels.fetch(config.discord.salesChannelId).catch(() => null);
    if (ch) {
      const buyer = `<@${order.discord_user_id}>`;
      ch.send({ embeds: [saleEmbed(order, items, buyer, `<@${interaction.user.id}>`)] }).catch(() => {});
    }
  }

  // Desabilita os botões da mensagem do Pix.
  await disableMessageComponents(interaction.message);

  await interaction.followUp({
    content: `Pedido aprovado (${brl(order.total)}) e cliente avisado. ✅`,
    ...eph,
  });
}

// Botão "Recusar" — abre modal pedindo o motivo.
export async function handleReject(interaction, orderId) {
  if (!ensureStaff(interaction)) return;

  const modal = new ModalBuilder()
    .setCustomId(`${IDS.rejectModal}:${orderId}`)
    .setTitle('Recusar pagamento');

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Motivo da recusa')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Ex.: pagamento não localizado no extrato.')
    .setRequired(true)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  await interaction.showModal(modal);
}

// Submit do modal de recusa — avisa o cliente, mantém o ticket aberto.
export async function handleRejectModal(interaction, orderId) {
  await interaction.deferReply(eph);
  const reason = interaction.fields.getTextInputValue('reason');

  const order = await getOrder(orderId);
  await updateOrder(orderId, { status: 'rejected', reject_reason: reason });

  await interaction.channel.send({
    content:
      `<@${order.discord_user_id}> ⛔ Seu pagamento foi recusado pela equipe.\n` +
      `**Motivo:** ${reason}\n\n` +
      `O ticket continua aberto — se achar que é engano, responda por aqui.`,
  });

  await interaction.editReply('Recusa registrada e cliente avisado.');
}

// Espera o PRÓXIMO anexo enviado por `userId` no canal (até `timeoutMs`). Como o Discord
// não permite upload de arquivo em modal, este é o jeito de capturar exatamente o arquivo
// pedido — e não uma imagem/mensagem antiga qualquer do ticket.
// `validate(att)` (opcional) filtra o tipo de anexo aceito.
function awaitAttachment(channel, userId, { timeoutMs = 120000, validate } = {}) {
  return new Promise((resolve) => {
    const collector = channel.createMessageCollector({
      filter: (m) =>
        m.author.id === userId &&
        m.attachments.size > 0 &&
        (!validate || m.attachments.some(validate)),
      max: 1,
      time: timeoutMs,
    });

    collector.on('collect', (m) => {
      const att = validate ? m.attachments.find(validate) : m.attachments.first();
      resolve(att ?? null);
    });

    collector.on('end', (collected) => {
      if (!collected.size) resolve(null);
    });
  });
}

async function disableMessageComponents(message) {
  if (!message?.components?.length) return;
  const rows = message.components.map((row) => {
    const r = ActionRowBuilder.from(row);
    r.components.forEach((c) => c.setDisabled?.(true));
    return r;
  });
  await message.edit({ components: rows }).catch(() => {});
}
