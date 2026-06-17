import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

export const brl = (v) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Rodapé padrão da marca (texto + ícone opcional). Reutilizado por todos os embeds.
function brandFooter(text) {
  return { text: text || config.brand.footer, iconURL: config.brand.logoUrl || undefined };
}

// Embed-base com a identidade visual da loja: cor da marca, faixa (banner) embaixo
// e rodapé com o nome/copyright. TODO embed do bot começa por aqui pra ficar padronizado.
// `banner: false` para embeds que já usam a imagem principal pra outra coisa (QR do Pix, card do ped).
export function brandEmbed({ banner = true, footer } = {}) {
  const embed = new EmbedBuilder().setColor(config.brandColor).setFooter(brandFooter(footer));
  if (banner && config.brand.bannerUrl) embed.setImage(config.brand.bannerUrl);
  return embed;
}

// Linha de um item (com quantidade e subtotal) reutilizada nos embeds.
export function itemLine(i) {
  const subtotal = Number(i.unit_price) * i.qty;
  const qtyLabel = i.qty > 1 ? ` ×${i.qty}` : '';
  const each = i.qty > 1 ? ` (${brl(i.unit_price)} cada)` : '';
  return `• ${i.product.name}${qtyLabel} — ${brl(subtotal)}${each}`;
}

// Card de um ped no catálogo (canal-vitrine ou ticket).
export function productEmbed(p) {
  // banner desligado: a imagem principal do card é o preview do ped.
  const embed = brandEmbed({ banner: false, footer: `${config.brand.name} • id: ${p.sku}` })
    .setTitle(p.name);

  if (p.description) embed.setDescription(p.description);
  if (p.image_url) embed.setImage(p.image_url);

  const fields = [{ name: 'Preço', value: brl(p.price), inline: true }];
  if (p.category) fields.push({ name: 'Categoria', value: p.category, inline: true });
  if (p.compatibility) fields.push({ name: 'Compatibilidade', value: p.compatibility, inline: true });
  embed.addFields(fields);

  return embed;
}

// Embed do carrinho, re-renderizado a cada item adicionado/removido.
export function cartEmbed(order, items) {
  const embed = brandEmbed().setTitle(
    `🛒 Carrinho — Pedido #${String(order.order_number).padStart(4, '0')}`,
  );

  if (!items.length) {
    embed.setDescription('_Seu carrinho está vazio. Selecione um ou mais peds no menu abaixo._');
    return embed;
  }

  const lines = items.map((i) => {
    const subtotal = Number(i.unit_price) * i.qty;
    const qtyLabel = i.qty > 1 ? ` ×${i.qty}` : '';
    const each = i.qty > 1 ? ` _(${brl(i.unit_price)} cada)_` : '';
    return `• **${i.product.name}**${qtyLabel} — ${brl(subtotal)}${each}`;
  });
  embed.setDescription(lines.join('\n'));
  embed.addFields({ name: 'Total', value: brl(order.total) });
  embed.addFields({
    name: '​',
    value: '_Use o menu abaixo para adicionar mais peds, ou finalize o pedido._',
  });
  return embed;
}

// Embed do Pix com QR Code, Copia e Cola e instruções.
export function pixEmbed(order, items, copiaECola, sellerName) {
  const txid = order.pix_txid;
  const lines = items.map((i) => itemLine(i));

  // banner desligado: a imagem principal é o QR Code (attachment://pix.png).
  return brandEmbed({ banner: false })
    .setTitle(`💳 Pagamento via Pix — Pedido #${String(order.order_number).padStart(4, '0')}`)
    .setDescription(
      [
        lines.join('\n'),
        '',
        `**Total: ${brl(order.total)}**`,
        sellerName ? `Pagamento para: **${sellerName}**` : null,
        '',
        '**Como pagar:**',
        '1️⃣ Escaneie o QR Code abaixo **ou** use o Pix Copia e Cola.',
        '2️⃣ **Anexe o comprovante** aqui no ticket.',
        '3️⃣ Clique em **Já paguei** para a equipe conferir e liberar.',
        '',
        '**Pix Copia e Cola:**',
        '```',
        copiaECola,
        '```',
        `Identificador (txid): \`${txid}\``,
        '',
        '_A confirmação é manual: a equipe valida o comprovante e envia o arquivo aqui._',
      ]
        .filter((l) => l !== null)
        .join('\n'),
    )
    .setImage('attachment://pix.png');
}

// Card de boas-vindas postado quando alguém entra no servidor (GuildMemberAdd).
export function welcomeEmbed(member) {
  const { catalogChannelId, ticketPanelChannelId } = config.discord;
  const createdAtSec = Math.floor(member.user.createdTimestamp / 1000);
  const accountDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);

  // Linhas de "atalho" da descrição: só aparecem se o canal estiver configurado.
  const shortcuts = [
    catalogChannelId ? `> <#${catalogChannelId}> **Conferir produtos**` : null,
    ticketPanelChannelId ? `> <#${ticketPanelChannelId}> **Qualquer dúvida abra um ticket**` : null,
  ].filter(Boolean);

  // banner desligado: a imagem principal do card é o banner de boas-vindas.
  const embed = brandEmbed({ banner: false })
    .setTitle(config.welcome.title || `🩷 Seja bem-vindo(a) ao ${config.brand.name}!`)
    .setDescription(
      [`Bem-vindo(a) <@${member.id}>!`, '', ...shortcuts].filter((l) => l !== null).join('\n'),
    )
    // Imagem pequena no canto: o avatar do próprio usuário que entrou (vem do Discord).
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Usuário', value: member.user.username, inline: true },
      { name: 'ID', value: member.id, inline: true },
      { name: 'Conta criada', value: `<t:${createdAtSec}:R>`, inline: true },
      { name: 'Tempo de conta', value: `${accountDays} dias`, inline: true },
      { name: 'Total de membros', value: String(member.guild.memberCount), inline: true },
    )
    .setTimestamp();

  if (config.welcome.imageUrl) embed.setImage(config.welcome.imageUrl);

  return embed;
}

// Card de anúncio/aviso oficial postado pela equipe pelo comando /anunciar.
// Usa a identidade visual padrão (cor, banner, rodapé) pra ficar profissional, mas
// o conteúdo (título + mensagem) é definido por quem rodou o comando, com Markdown.
export function announceEmbed({ title, message, imageUrl }) {
  const hasImage = Boolean(imageUrl);
  // Se a pessoa passou uma imagem, ela vira a imagem principal e desligamos o banner
  // padrão; senão mantemos a faixa da marca embaixo.
  const embed = brandEmbed({ banner: !hasImage })
    .setTitle(title || `📢 ${config.brand.name}`)
    .setDescription(message)
    .setTimestamp();

  if (hasImage) embed.setImage(imageUrl);
  return embed;
}

// Mensagem de venda registrada no canal #vendas.
export function saleEmbed(order, items, buyerTag, approverTag) {
  return brandEmbed()
    .setColor(0x2ecc71) // verde de "venda concluída", sobrescreve a cor da marca
    .setTitle(`✅ Venda — Pedido #${String(order.order_number).padStart(4, '0')}`)
    .setDescription(items.map((i) => itemLine(i)).join('\n'))
    .addFields(
      { name: 'Total', value: brl(order.total), inline: true },
      { name: 'Comprador', value: buyerTag, inline: true },
      { name: 'Recebido por', value: order.claimed_by ? `<@${order.claimed_by}>` : '—', inline: true },
      { name: 'Aprovado por', value: approverTag, inline: true },
      { name: 'txid', value: order.pix_txid || '—', inline: true },
    )
    .setTimestamp();
}
