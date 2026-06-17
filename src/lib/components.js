import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { brl } from './embeds.js';

// IDs dos componentes. Formato: prefixo:dado — facilita o roteamento.
export const IDS = {
  buy: 'buy',                 // botão "comprar" -> buy:<productId> (cria/usa ticket)
  browse: 'browse_catalog',   // select menu da vitrine (ver 1 ped)
  openCatalog: 'open_catalog',// botão "abrir catálogo" no painel/ticket
  addItems: 'add_items',      // select menu do carrinho
  editQty: 'edit_qty',        // select menu "ajustar quantidade" -> abre modal
  qtyModal: 'qty_modal',      // modal de quantidade -> qty_modal:<productId>
  qtyInput: 'qty_input',      // campo de texto do modal de quantidade
  checkout: 'checkout',       // botão "finalizar / gerar Pix"
  clearCart: 'clear_cart',
  paidClaim: 'paid_claim',    // botão "já paguei" do cliente -> paid_claim:<orderId>
  approve: 'approve',         // approve:<orderId>
  reject: 'reject',           // reject:<orderId>
  copyPix: 'copy_pix',        // copy_pix:<orderId>
  rejectModal: 'reject_modal',// reject_modal:<orderId>
  announceModal: 'announce_modal', // modal do /anunciar -> announce_modal:<channelId>
};

// Botão "Comprar" abaixo de cada card da vitrine.
export function buyButtonRow(productId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.buy}:${productId}`)
      .setLabel('Comprar')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🛒'),
  );
}

// Select menu que lista o catálogo inteiro (múltipla escolha).
export function catalogSelectRow(products) {
  const options = products.slice(0, 25).map((p) => ({
    label: p.name.slice(0, 100),
    description: `${brl(p.price)}${p.category ? ` • ${p.category}` : ''}`.slice(0, 100),
    value: p.id,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(IDS.addItems)
    .setPlaceholder('Adicionar mais peds…')
    .setMinValues(1)
    .setMaxValues(Math.max(1, options.length))
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// Select menu "Ajustar quantidade…": lista os itens já no carrinho. Ao escolher
// um item, abre um modal pra digitar a quantidade exata (0 = remover).
export function editQtyRow(items) {
  const options = items.slice(0, 25).map((i) => ({
    label: `${i.product.name} (×${i.qty})`.slice(0, 100),
    description: `${brl(i.unit_price)} cada • alterar quantidade`.slice(0, 100),
    value: i.product_id,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(IDS.editQty)
    .setPlaceholder('Ajustar quantidade de um item…')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(options.length === 0)
    .addOptions(
      options.length
        ? options
        : [{ label: 'Carrinho vazio', value: 'none', description: 'Adicione um ped primeiro' }],
    );

  return new ActionRowBuilder().addComponents(menu);
}

// Modal pra digitar a quantidade exata de um item do carrinho.
export function qtyModal(product, currentQty) {
  const input = new TextInputBuilder()
    .setCustomId(IDS.qtyInput)
    .setLabel(`Quantidade (0 = remover)`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(3)
    .setRequired(true)
    .setValue(String(currentQty));

  return new ModalBuilder()
    .setCustomId(`${IDS.qtyModal}:${product.id}`)
    .setTitle(`Qtd — ${product.name}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

// Botões de ação do carrinho.
export function cartActionsRow(hasItems) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.checkout)
      .setLabel('Finalizar e gerar Pix')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💳')
      .setDisabled(!hasItems),
    new ButtonBuilder()
      .setCustomId(IDS.clearCart)
      .setLabel('Esvaziar')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasItems),
  );
}

// Select menu da vitrine pública: lista o catálogo; ao escolher, mostra 1 ped.
export function browseCatalogRow(products) {
  const options = products.slice(0, 25).map((p) => ({
    label: p.name.slice(0, 100),
    description: `${brl(p.price)}${p.category ? ` • ${p.category}` : ''}`.slice(0, 100),
    value: p.id,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(IDS.browse)
    .setPlaceholder('Ver um ped do catálogo…')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// Botões do cliente no embed do Pix.
export function pixBuyerRow(orderId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.copyPix}:${orderId}`)
      .setLabel('Copiar Pix')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋'),
    new ButtonBuilder()
      .setCustomId(`${IDS.paidClaim}:${orderId}`)
      .setLabel('Já paguei (enviar comprovante)')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
  );
}

// Botões da equipe (aparecem quando o cliente avisa que pagou).
export function staffActionsRow(orderId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.copyPix}:${orderId}`)
      .setLabel('Copiar Pix')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋'),
    new ButtonBuilder()
      .setCustomId(`${IDS.approve}:${orderId}`)
      .setLabel('Aprovar')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`${IDS.reject}:${orderId}`)
      .setLabel('Recusar')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⛔'),
  );
}

// Painel inicial (botão para abrir o catálogo dentro do ticket).
export function openCatalogRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.openCatalog)
      .setLabel('Abrir catálogo')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📜'),
  );
}
