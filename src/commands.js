import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config.js';
import { listActiveProducts, createProduct, deactivateProductBySku } from './db/products.js';
import { createCoupon, deactivateCoupon, listCoupons, normalizeCode } from './db/coupons.js';
import { browseCatalogRow, IDS } from './lib/components.js';
import { brandEmbed, welcomeEmbed, announceEmbed, brl } from './lib/embeds.js';
import { TICKET_IDS } from './interactions/tickets.js';

const eph = { flags: MessageFlags.Ephemeral };

// Definições registradas no Discord (deploy-commands.js usa isto).
export const commandData = [
  new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Posta o painel público para abrir tickets.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('bemvindo-teste')
    .setDescription('Mostra (só pra você) uma prévia do card de boas-vindas.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('anunciar')
    .setDescription('Publica um anúncio profissional pelo bot, com o card padrão da loja.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('canal')
        .setDescription('Canal onde o anúncio será postado (padrão: canal atual).')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

  new SlashCommandBuilder()
    .setName('vitrine')
    .setDescription('Posta/atualiza o catálogo (cards com botão Comprar) no canal de catálogo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('produto-add')
    .setDescription('Cadastra um novo ped no catálogo.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('sku').setDescription('Identificador, ex.: PED-0042').setRequired(true))
    .addStringOption((o) => o.setName('nome').setDescription('Nome do ped').setRequired(true))
    .addNumberOption((o) => o.setName('preco').setDescription('Preço em reais, ex.: 49.90').setRequired(true))
    .addStringOption((o) => o.setName('descricao').setDescription('Lore / descrição'))
    .addStringOption((o) => o.setName('categoria').setDescription('Categoria'))
    .addStringOption((o) => o.setName('compatibilidade').setDescription('Ex.: MP / SP'))
    .addStringOption((o) => o.setName('imagem').setDescription('URL da imagem de preview')),

  new SlashCommandBuilder()
    .setName('produto-remover')
    .setDescription('Remove um ped do catálogo (some da vitrine; pedidos antigos continuam intactos).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName('produto')
        .setDescription('Escolha o ped a remover')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  new SlashCommandBuilder()
    .setName('cupom-add')
    .setDescription('Cria um cupom de desconto que o cliente aplica no carrinho.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o.setName('codigo').setDescription('Código do cupom, ex.: BEMVINDO10').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('tipo')
        .setDescription('Porcentagem (%) ou valor fixo (R$)')
        .setRequired(true)
        .addChoices(
          { name: 'Porcentagem (%)', value: 'percent' },
          { name: 'Valor fixo (R$)', value: 'fixed' },
        ))
    .addNumberOption((o) =>
      o
        .setName('valor')
        .setDescription('Para %: 10 = 10%. Para R$: 20 = R$ 20 de desconto.')
        .setRequired(true)
        .setMinValue(0.01))
    .addStringOption((o) =>
      o.setName('expira').setDescription('Validade no formato AAAA-MM-DD (opcional).'))
    .addIntegerOption((o) =>
      o
        .setName('limite')
        .setDescription('Limite de usos (opcional). Ex.: 50 = vale só nas 50 primeiras vendas.')
        .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('cupom-remover')
    .setDescription('Desativa um cupom (para de funcionar; histórico de usos é mantido).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName('codigo')
        .setDescription('Escolha o cupom a desativar')
        .setRequired(true)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('cupom-listar')
    .setDescription('Lista os cupons cadastrados (ativos e inativos).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

// Roteia o comando slash recebido.
export async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'painel':
      return cmdPainel(interaction);
    case 'bemvindo-teste':
      return cmdBemvindoTeste(interaction);
    case 'anunciar':
      return cmdAnunciar(interaction);
    case 'vitrine':
      return cmdVitrine(interaction);
    case 'produto-add':
      return cmdProdutoAdd(interaction);
    case 'produto-remover':
      return cmdProdutoRemover(interaction);
    case 'cupom-add':
      return cmdCupomAdd(interaction);
    case 'cupom-remover':
      return cmdCupomRemover(interaction);
    case 'cupom-listar':
      return cmdCupomListar(interaction);
    default:
      return interaction.reply({ content: 'Comando desconhecido.', ...eph });
  }
}

// Autocomplete: sugere peds ativos (produto-remover) ou cupons ativos (cupom-remover).
export async function handleAutocomplete(interaction) {
  const query = interaction.options.getFocused().toLowerCase();
  try {
    if (interaction.commandName === 'produto-remover') {
      const products = await listActiveProducts();
      const choices = products
        .filter((p) => !query || p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query))
        .slice(0, 25)
        .map((p) => ({ name: `${p.name} — ${p.sku} (R$ ${Number(p.price).toFixed(2)})`.slice(0, 100), value: p.sku }));
      return interaction.respond(choices);
    }

    if (interaction.commandName === 'cupom-remover') {
      const coupons = await listCoupons();
      const choices = coupons
        .filter((c) => c.active && (!query || c.code.toLowerCase().includes(query)))
        .slice(0, 25)
        .map((c) => ({ name: `${c.code} (${couponValueLabel(c)})`.slice(0, 100), value: c.code }));
      return interaction.respond(choices);
    }

    return interaction.respond([]);
  } catch {
    await interaction.respond([]);
  }
}

async function cmdPainel(interaction) {
  const embed = brandEmbed()
    .setTitle(`🛒 ${config.brand.name}`)
    .setDescription('Clique abaixo para abrir um ticket e comprar seus peds com segurança.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_IDS.open)
      .setLabel('Abrir ticket')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎫'),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: 'Painel publicado ✅', ...eph });
}

// Prévia do card de boas-vindas, usando quem rodou o comando como "membro que entrou".
// Resposta efêmera: só você vê, não polui o canal e dá pra repetir à vontade.
async function cmdBemvindoTeste(interaction) {
  await interaction.reply({
    content: '👀 Prévia do card de boas-vindas (só você vê):',
    embeds: [welcomeEmbed(interaction.member)],
    ...eph,
  });
}

// Abre o modal onde o admin escreve o anúncio. O canal de destino vai embutido no
// customId do modal (announce_modal:<channelId>), já que o modal em si não tem opções.
async function cmdAnunciar(interaction) {
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  const titulo = new TextInputBuilder()
    .setCustomId('titulo')
    .setLabel('Título (opcional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(false);

  const mensagem = new TextInputBuilder()
    .setCustomId('mensagem')
    .setLabel('Mensagem (aceita formatação Markdown)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Use **negrito**, *itálico*, listas, links… como numa mensagem normal.')
    .setMaxLength(4000)
    .setRequired(true);

  const imagem = new TextInputBuilder()
    .setCustomId('imagem')
    .setLabel('URL de imagem (opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://… — substitui o banner padrão do card')
    .setRequired(false);

  const modal = new ModalBuilder()
    .setCustomId(`${IDS.announceModal}:${channel.id}`)
    .setTitle('Novo anúncio')
    .addComponents(
      new ActionRowBuilder().addComponents(titulo),
      new ActionRowBuilder().addComponents(mensagem),
      new ActionRowBuilder().addComponents(imagem),
    );

  await interaction.showModal(modal);
}

// Submit do modal de /anunciar — monta o card padrão e publica no canal escolhido.
export async function handleAnnounceModal(interaction, channelId) {
  await interaction.deferReply(eph);

  const title = interaction.fields.getTextInputValue('titulo').trim() || null;
  const message = interaction.fields.getTextInputValue('mensagem');
  const rawImage = interaction.fields.getTextInputValue('imagem').trim();
  // Só aceita http(s); uma URL inválida faria o channel.send falhar.
  const imageUrl = /^https?:\/\//i.test(rawImage) ? rawImage : null;

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return interaction.editReply('❌ Canal de destino indisponível. Tente novamente.');
  }

  try {
    await channel.send({ embeds: [announceEmbed({ title, message, imageUrl })] });
  } catch (err) {
    return interaction.editReply(
      `❌ Não consegui publicar em ${channel}. Verifique se tenho permissão de enviar mensagens lá.\n` +
        `Detalhe: ${err.message}`,
    );
  }

  const aviso = rawImage && !imageUrl ? '\n⚠️ A imagem foi ignorada: informe uma URL começando com http(s).' : '';
  await interaction.editReply(`✅ Anúncio publicado em ${channel}.${aviso}`);
}

async function cmdVitrine(interaction) {
  await interaction.deferReply(eph);
  const channelId = config.discord.catalogChannelId;
  const channel = channelId
    ? await interaction.client.channels.fetch(channelId).catch(() => null)
    : interaction.channel;
  if (!channel) return interaction.editReply('Canal de catálogo não encontrado (CATALOG_CHANNEL_ID).');

  const products = await listActiveProducts();
  if (!products.length) return interaction.editReply('Nenhum produto cadastrado ainda.');

  const embed = brandEmbed()
    .setTitle('🛒 Catálogo')
    .setDescription(
      `Use o menu abaixo para ver os detalhes de cada ped. **${products.length}** item(ns) disponível(is).\n` +
        'Ao escolher um, você verá o card com preço e a opção de **Comprar** (abre seu atendimento).',
    );

  await channel.send({ embeds: [embed], components: [browseCatalogRow(products)] });
  await interaction.editReply(`Vitrine publicada com ${products.length} ped(s) em ${channel}.`);
}

async function cmdProdutoAdd(interaction) {
  await interaction.deferReply(eph);
  try {
    const product = await createProduct({
      sku: interaction.options.getString('sku'),
      name: interaction.options.getString('nome'),
      price: interaction.options.getNumber('preco'),
      description: interaction.options.getString('descricao') || null,
      category: interaction.options.getString('categoria') || null,
      compatibility: interaction.options.getString('compatibilidade') || null,
      image_url: interaction.options.getString('imagem') || null,
    });
    await interaction.editReply(`Ped cadastrado: **${product.name}** (id ${product.sku}).`);
  } catch (err) {
    await interaction.editReply(`Erro ao cadastrar: ${err.message}`);
  }
}

async function cmdProdutoRemover(interaction) {
  await interaction.deferReply(eph);
  const sku = interaction.options.getString('produto');
  try {
    const product = await deactivateProductBySku(sku);
    if (!product) {
      return interaction.editReply(`Nenhum ped ativo encontrado com o id \`${sku}\`.`);
    }
    await interaction.editReply(
      `Ped removido do catálogo: **${product.name}** (${product.sku}).\n` +
        'Rode `/vitrine` para atualizar a vitrine publicada.',
    );
  } catch (err) {
    // .single() lança erro quando não acha nenhuma linha pra atualizar.
    if (err.code === 'PGRST116') {
      return interaction.editReply(`Nenhum ped ativo encontrado com o id \`${sku}\`.`);
    }
    await interaction.editReply(`Erro ao remover: ${err.message}`);
  }
}

// Texto legível do valor de um cupom (ex.: "10%" ou "R$ 20,00").
function couponValueLabel(c) {
  return c.type === 'percent' ? `${Number(c.value)}%` : brl(c.value);
}

async function cmdCupomAdd(interaction) {
  await interaction.deferReply(eph);

  const code = normalizeCode(interaction.options.getString('codigo'));
  const type = interaction.options.getString('tipo'); // 'percent' | 'fixed'
  const value = interaction.options.getNumber('valor');
  const expiraRaw = interaction.options.getString('expira');
  const maxUses = interaction.options.getInteger('limite');

  if (type === 'percent' && value > 100) {
    return interaction.editReply('Para cupom de porcentagem, o valor não pode passar de 100.');
  }

  // Validade: aceita AAAA-MM-DD; converte pro fim do dia para o cupom valer o dia todo.
  let expiresAt = null;
  if (expiraRaw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiraRaw.trim());
    if (!m) {
      return interaction.editReply('Data de validade inválida. Use o formato `AAAA-MM-DD` (ex.: 2026-12-31).');
    }
    const date = new Date(`${expiraRaw.trim()}T23:59:59`);
    if (Number.isNaN(date.getTime())) {
      return interaction.editReply('Data de validade inválida. Use o formato `AAAA-MM-DD` (ex.: 2026-12-31).');
    }
    expiresAt = date.toISOString();
  }

  try {
    const coupon = await createCoupon({
      code,
      type,
      value,
      expires_at: expiresAt,
      max_uses: maxUses ?? null,
    });

    const regras = [
      `Desconto: **${couponValueLabel(coupon)}**`,
      coupon.expires_at ? `Validade: até ${expiraRaw.trim()}` : 'Validade: sem expiração',
      coupon.max_uses != null ? `Limite de usos: ${coupon.max_uses}` : 'Limite de usos: ilimitado',
    ].join('\n');

    await interaction.editReply(`✅ Cupom **${coupon.code}** criado.\n${regras}`);
  } catch (err) {
    // 23505 = violação de unique (código já existe).
    if (err.code === '23505') {
      return interaction.editReply(`Já existe um cupom com o código \`${code}\`.`);
    }
    await interaction.editReply(`Erro ao criar o cupom: ${err.message}`);
  }
}

async function cmdCupomRemover(interaction) {
  await interaction.deferReply(eph);
  const code = normalizeCode(interaction.options.getString('codigo'));
  try {
    const coupon = await deactivateCoupon(code);
    if (!coupon) {
      return interaction.editReply(`Nenhum cupom ativo encontrado com o código \`${code}\`.`);
    }
    await interaction.editReply(`🗑️ Cupom **${coupon.code}** desativado. Não pode mais ser aplicado.`);
  } catch (err) {
    await interaction.editReply(`Erro ao desativar o cupom: ${err.message}`);
  }
}

async function cmdCupomListar(interaction) {
  await interaction.deferReply(eph);
  const coupons = await listCoupons();
  if (!coupons.length) {
    return interaction.editReply('Nenhum cupom cadastrado ainda. Crie um com `/cupom-add`.');
  }

  const lines = coupons.map((c) => {
    const status = c.active ? '🟢' : '⚪';
    const partes = [`${status} **${c.code}** — ${couponValueLabel(c)}`];
    if (c.expires_at) partes.push(`expira ${new Date(c.expires_at).toLocaleDateString('pt-BR')}`);
    const usos = c.max_uses != null ? `${c.uses}/${c.max_uses} usos` : `${c.uses} usos`;
    partes.push(usos);
    return partes.join(' • ');
  });

  const embed = brandEmbed({ banner: false })
    .setTitle('🏷️ Cupons cadastrados')
    .setDescription(lines.join('\n').slice(0, 4000));

  await interaction.editReply({ embeds: [embed] });
}
