import { MessageFlags, AttachmentBuilder } from 'discord.js';
import QRCode from 'qrcode';
import { getOpenOrderByChannel, getOrderItems, updateOrder } from '../db/orders.js';
import { getSellerByDiscordId } from '../db/sellers.js';
import { gerarPixCopiaECola } from '../lib/pix.js';
import { pixEmbed } from '../lib/embeds.js';
import { pixBuyerRow } from '../lib/components.js';

const eph = { flags: MessageFlags.Ephemeral };

// Botão "Finalizar e gerar Pix".
export async function handleCheckout(interaction) {
  await interaction.deferReply(eph);

  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return interaction.editReply('Nenhum carrinho aberto neste ticket.');

  const items = await getOrderItems(order.id);
  if (!items.length) return interaction.editReply('Seu carrinho está vazio.');

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
  const total = items.reduce((s, i) => s + Number(i.unit_price) * i.qty, 0);

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
  if (order.cart_message_id) {
    interaction.channel.messages
      .fetch(order.cart_message_id)
      .then((m) => m.delete())
      .catch(() => {});
    await updateOrder(order.id, { cart_message_id: null });
  }

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
