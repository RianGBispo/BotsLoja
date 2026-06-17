import { MessageFlags } from 'discord.js';
import { IDS } from '../lib/components.js';
import { handleCommand, handleAutocomplete, handleAnnounceModal } from '../commands.js';
import {
  handleOpenCatalog,
  handleBuy,
  handleBrowse,
  handleAddItems,
  handleEditQty,
  handleQtyModal,
  handleClearCart,
} from './catalog.js';
import { handleCheckout } from './checkout.js';
import {
  handleApprove,
  handleReject,
  handleRejectModal,
  handleCopyPix,
  handlePaidClaim,
} from './staff.js';
import { handleOpenTicket, handleCloseTicket, handleClaim, TICKET_IDS } from './tickets.js';

// Separa "prefixo:dado" do customId.
function parse(customId) {
  const idx = customId.indexOf(':');
  if (idx === -1) return { prefix: customId, arg: null };
  return { prefix: customId.slice(0, idx), arg: customId.slice(idx + 1) };
}

export async function routeInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isAutocomplete()) return await handleAutocomplete(interaction);

    if (interaction.isButton()) {
      const { prefix, arg } = parse(interaction.customId);
      switch (prefix) {
        case TICKET_IDS.open:    return await handleOpenTicket(interaction);
        case TICKET_IDS.close:   return await handleCloseTicket(interaction);
        case TICKET_IDS.claim:   return await handleClaim(interaction);
        case IDS.openCatalog:    return await handleOpenCatalog(interaction);
        case IDS.buy:            return await handleBuy(interaction, arg);
        case IDS.checkout:       return await handleCheckout(interaction);
        case IDS.clearCart:      return await handleClearCart(interaction);
        case IDS.paidClaim:      return await handlePaidClaim(interaction, arg);
        case IDS.copyPix:        return await handleCopyPix(interaction, arg);
        case IDS.approve:        return await handleApprove(interaction, arg);
        case IDS.reject:         return await handleReject(interaction, arg);
        default: return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      const { prefix } = parse(interaction.customId);
      if (prefix === IDS.addItems) return await handleAddItems(interaction);
      if (prefix === IDS.editQty) return await handleEditQty(interaction);
      if (prefix === IDS.browse) return await handleBrowse(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const { prefix, arg } = parse(interaction.customId);
      if (prefix === IDS.rejectModal) return await handleRejectModal(interaction, arg);
      if (prefix === IDS.qtyModal) return await handleQtyModal(interaction, arg);
      if (prefix === IDS.announceModal) return await handleAnnounceModal(interaction, arg);
      return;
    }
  } catch (err) {
    console.error('Erro ao processar interação:', err);
    const msg = '❌ Ocorreu um erro ao processar a ação. Tente novamente.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    } catch {}
  }
}
