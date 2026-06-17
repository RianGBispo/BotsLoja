import { MessageFlags, AttachmentBuilder } from 'discord.js';
import QRCode from 'qrcode';
import { getOpenOrderByChannel, getOrderItems, updateOrder, recalcTotal } from '../db/orders.js';
import { getSellerByDiscordId } from '../db/sellers.js';
import { gerarPixCopiaECola } from '../lib/pix.js';
import { pixEmbed, freeOrderEmbed } from '../lib/embeds.js';
import { pixBuyerRow, staffActionsRow } from '../lib/components.js';
import { config } from '../config.js';

const eph = { flags: MessageFlags.Ephemeral };

// Apaga a mensagem do carrinho editável (após finalizar) e zera o cart_message_id.
async function removeCartMessage(interaction, order) {
  if (!order.cart_message_id) return;
  interaction.channel.messages
    .fetch(order.cart_message_id)
    .then((m) => m.delete())
    .catch(() => {});
  await updateOrder(order.id, { cart_message_id: null });
}

// Botão "Finalizar e gerar Pix".
export async function handleCheckout(interaction) {
  await interaction.deferReply(eph);

  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return interaction.editReply('Nenhum carrinho aberto neste ticket.');

  const items = await getOrderItems(order.id);
  if (!items.length) return interaction.editReply('Seu carrinho está vazio.');

  // Recalcula com o cupom aplicado (revalida e solta cupom que tiver expirado/esgotado).
  // É este total já com desconto que vira o valor do Pix.
  const { total } = await recalcTotal(order.id);

  // Pedido zerado por cupom (ex.: 100% de desconto, ou cupom fixo ≥ subtotal): não há o que
  // pagar e o gerador de Pix EMV exige um valor > 0. Então não geramos QR/Pix — o pedido vai
  // direto para a revisão da equipe, que confere e entrega. Não exige sócia (não há Pix a receber).
  if (total <= 0) {
    return finalizeFreeOrder(interaction, order, items);
  }

  // Quem assumiu o ticket é quem recebe o Pix. Sem ninguém assumido, não geramos
  // o Pix — assim o dinheiro nunca cai numa conta errada.
  const seller = await getSellerByDiscordId(order.claimed_by);
  if (!seller) {
    return interaction.editReply(
      '⏳ Aguarde uma atendente **assumir o atendimento** antes de gerar o Pix. ' +
        'Assim o pagamento cai direto na conta certa.',
    );
  }

  // txid baseado no número do pedido: MN0042
  const txid = `MN${String(order.order_number).padStart(4, '0')}`;

  const copiaECola = gerarPixCopiaECola({
    key: seller.pix_key,
    amount: total,
    merchantName: seller.merchant_name,
    merchantCity: seller.merchant_city,
    txid,
  });

  const updated = await updateOrder(order.id, {
    status: 'pending_payment',
    pix_txid: txid,
    total,
  });

  // Remove o carrinho editável para evitar mudanças após gerar o Pix.
  await removeCartMessage(interaction, order);

  // Gera a imagem do QR Code localmente (sem enviar o Pix a terceiros).
  const qrBuffer = await QRCode.toBuffer(copiaECola, { width: 360, margin: 1 });
  const qrFile = new AttachmentBuilder(qrBuffer, { name: 'pix.png' });

  await interaction.channel.send({
    embeds: [pixEmbed(updated, items, copiaECola, seller.name)],
    files: [qrFile],
    components: [pixBuyerRow(order.id)],
  });

  await interaction.editReply('Pix gerado abaixo 👇 Pague, anexe o comprovante e clique em "Já paguei".');
}

// Finaliza um pedido gratuito (cupom cobriu o total): sem Pix/QR. Pula a etapa de pagamento,
// marca como awaiting_review e chama a equipe para conferir o cupom e entregar o arquivo.
async function finalizeFreeOrder(interaction, order, items) {
  const updated = await updateOrder(order.id, {
    status: 'awaiting_review',
    pix_txid: null,
    total: 0,
  });

  await removeCartMessage(interaction, order);

  const num = String(updated.order_number).padStart(4, '0');
  const cupom = updated.coupon_code ? `**${updated.coupon_code}**` : 'um cupom';

  await interaction.channel.send({
    content:
      `<@&${config.discord.staffRoleId}> 🎁 O pedido **#${num}** ficou **gratuito** com o cupom ${cupom}. ` +
      'Não há Pix a pagar — confiram e liberem a entrega abaixo:',
    embeds: [freeOrderEmbed(updated, items)],
    components: [staffActionsRow(order.id, { withPix: false })],
  });

  await interaction.editReply(
    'Seu pedido ficou **gratuito** com o cupom! 🎉 Não há nada a pagar — a equipe vai conferir e ' +
      'entregar o arquivo aqui no ticket.',
  );
}
