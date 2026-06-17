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
import { browseCatalogRow, IDS } from './lib/components.js';
import { brandEmbed, welcomeEmbed, announceEmbed } from './lib/embeds.js';
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
    default:
      return interaction.reply({ content: 'Comando desconhecido.', ...eph });
  }
}

// Autocomplete: sugere peds ativos pelo nome/SKU enquanto o staff digita.
export async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'produto-remover') return interaction.respond([]);
  const query = interaction.options.getFocused().toLowerCase();
  try {
    const products = await listActiveProducts();
    const choices = products
      .filter((p) => !query || p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query))
      .slice(0, 25)
      .map((p) => ({ name: `${p.name} — ${p.sku} (R$ ${Number(p.price).toFixed(2)})`.slice(0, 100), value: p.sku }));
    await interaction.respond(choices);
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
