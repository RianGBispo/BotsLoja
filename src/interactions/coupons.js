import { MessageFlags } from 'discord.js';
import { getOpenOrderByChannel, getOrderItems, updateOrder } from '../db/orders.js';
import { getCouponByCode, validateCoupon, normalizeCode, COUPON_REASONS } from '../db/coupons.js';
import { refreshCartMessage } from '../lib/cartView.js';
import { couponModal, IDS } from '../lib/components.js';
import { brl } from '../lib/embeds.js';

const eph = { flags: MessageFlags.Ephemeral };

// Botão "Aplicar cupom" -> abre o modal pra digitar o código.
export async function handleApplyCoupon(interaction) {
  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) {
    return interaction.reply({ content: 'Nenhum carrinho aberto neste ticket.', ...eph });
  }
  await interaction.showModal(couponModal(order.coupon_code));
}

// Submit do modal de cupom -> valida e aplica (ou avisa o motivo da recusa).
export async function handleCouponModal(interaction) {
  await interaction.deferReply(eph);

  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return interaction.editReply('Não encontrei um pedido aberto neste ticket.');

  const code = normalizeCode(interaction.fields.getTextInputValue(IDS.couponInput));
  if (!code) return interaction.editReply('Digite um código de cupom válido.');

  // Subtotal atual (sem desconto) pra validar o cupom contra os itens do carrinho.
  const items = await getOrderItems(order.id);
  if (!items.length) return interaction.editReply('Adicione itens ao carrinho antes de aplicar um cupom.');
  const subtotal = items.reduce((s, i) => s + Number(i.unit_price) * i.qty, 0);

  const coupon = await getCouponByCode(code);
  const res = validateCoupon(coupon, subtotal);
  if (!res.ok) {
    return interaction.editReply(`❌ ${COUPON_REASONS[res.reason] || 'Cupom inválido.'}`);
  }

  await updateOrder(order.id, { coupon_code: coupon.code });
  await refreshCartMessage(interaction.channel, order);

  await interaction.editReply(
    `✅ Cupom **${coupon.code}** aplicado: **−${brl(res.discount)}** de desconto. Veja o carrinho atualizado acima.`,
  );
}

// Botão "Remover cupom" -> tira o cupom do pedido e re-renderiza o carrinho.
export async function handleRemoveCoupon(interaction) {
  await interaction.deferUpdate();
  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return;
  await updateOrder(order.id, { coupon_code: null, discount: 0 });
  await refreshCartMessage(interaction.channel, order);
}
