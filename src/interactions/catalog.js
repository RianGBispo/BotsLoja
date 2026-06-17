import { MessageFlags } from 'discord.js';
import {
  getOrCreateOrder,
  getOpenOrderByChannel,
  getOrderItems,
  addItems,
  setItemQty,
  recalcTotal,
} from '../db/orders.js';
import { getProductsByIds, getProduct } from '../db/products.js';
import { refreshCartMessage } from '../lib/cartView.js';
import { productEmbed } from '../lib/embeds.js';
import { buyButtonRow, qtyModal, IDS } from '../lib/components.js';
import { getOrCreateTicketChannel } from './tickets.js';
import { supabase } from '../lib/supabase.js';

const eph = { flags: MessageFlags.Ephemeral };

// Select menu da vitrine -> mostra o card do ped escolhido (só pra quem clicou) + botão Comprar.
export async function handleBrowse(interaction) {
  await interaction.deferReply(eph);
  const product = await getProduct(interaction.values[0]).catch(() => null);
  if (!product) return interaction.editReply('Esse ped não está mais disponível.');

  await interaction.editReply({
    embeds: [productEmbed(product)],
    components: [buyButtonRow(product.id)],
  });
}

// Botão "Comprar" -> abre (ou usa) o ticket individual, adiciona o item e abre o atendimento.
export async function handleBuy(interaction, productId) {
  await interaction.deferReply(eph);
  const product = await getProduct(productId).catch(() => null);
  if (!product) return interaction.editReply('Produto não encontrado ou indisponível.');

  const channel = await getOrCreateTicketChannel(interaction);
  const order = await getOrCreateOrder({
    discordUserId: interaction.user.id,
    channelId: channel.id,
  });
  await addItems(order.id, [product]);
  await refreshCartMessage(channel, order);

  await interaction.editReply(
    `Adicionei **${product.name}** ao seu pedido. Continue o atendimento no seu ticket: ${channel}`,
  );
}

// Botão "Abrir catálogo" -> garante um pedido e mostra o carrinho (uso dentro do ticket).
export async function handleOpenCatalog(interaction) {
  await interaction.deferReply(eph);
  const order = await getOrCreateOrder({
    discordUserId: interaction.user.id,
    channelId: interaction.channelId,
  });
  await refreshCartMessage(interaction.channel, order);
  await interaction.editReply('Catálogo aberto abaixo 👇 Use o menu para montar seu carrinho.');
}

// Select menu "Adicionar mais peds…"
export async function handleAddItems(interaction) {
  await interaction.deferUpdate();
  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return;

  const products = await getProductsByIds(interaction.values);
  await addItems(order.id, products);
  await refreshCartMessage(interaction.channel, order);
}

// Select "Ajustar quantidade…" -> abre o modal pra digitar a qtd do item escolhido.
export async function handleEditQty(interaction) {
  const productId = interaction.values[0];
  if (productId === 'none') return interaction.deferUpdate();

  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return interaction.deferUpdate();

  const items = await getOrderItems(order.id);
  const item = items.find((i) => i.product_id === productId);
  if (!item) return interaction.deferUpdate();

  await interaction.showModal(qtyModal(item.product, item.qty));
}

// Submit do modal de quantidade -> grava a qtd (0 remove) e re-renderiza o carrinho.
export async function handleQtyModal(interaction, productId) {
  await interaction.deferReply(eph);
  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return interaction.editReply('Não encontrei um pedido aberto neste ticket.');

  const raw = interaction.fields.getTextInputValue(IDS.qtyInput).trim();
  const qty = Number.parseInt(raw, 10);
  if (Number.isNaN(qty) || qty < 0) {
    return interaction.editReply('Quantidade inválida. Digite um número inteiro (0 para remover).');
  }

  await setItemQty(order.id, productId, qty);
  await refreshCartMessage(interaction.channel, order);

  const product = await getProduct(productId).catch(() => null);
  const name = product?.name ?? 'item';
  await interaction.editReply(
    qty === 0 ? `Removi **${name}** do carrinho.` : `Quantidade de **${name}** definida para **${qty}**.`,
  );
}

// Botão "Esvaziar".
export async function handleClearCart(interaction) {
  await interaction.deferUpdate();
  const order = await getOpenOrderByChannel(interaction.channelId);
  if (!order) return;

  await supabase.from('order_items').delete().eq('order_id', order.id);
  await recalcTotal(order.id);
  await refreshCartMessage(interaction.channel, order);
}
