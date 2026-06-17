import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('GUILD_ID'),
    staffRoleId: required('STAFF_ROLE_ID'),
    ticketCategoryId: process.env.TICKET_CATEGORY_ID || null,
    // Canal onde fica o painel "Abrir ticket" (postado com /painel); citado no card de boas-vindas.
    ticketPanelChannelId: process.env.TICKET_PANEL_CHANNEL_ID || null,
    catalogChannelId: process.env.CATALOG_CHANNEL_ID || null,
    salesChannelId: process.env.SALES_CHANNEL_ID || null,
    transcriptChannelId: process.env.TRANSCRIPT_CHANNEL_ID || null,
    // Canal onde a mensagem de boas-vindas é postada quando alguém entra (deixe vazio pra desativar).
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
  },
  // Mensagem de boas-vindas (GuildMemberAdd).
  welcome: {
    title: process.env.WELCOME_TITLE || null, // se vazio, usa um título padrão com o nome da marca
    imageUrl: process.env.WELCOME_IMAGE_URL || null, // banner grande exibido no card
    // A imagem pequena do canto é o avatar do usuário que entrou (vem do Discord, não do .env).
  },
  supabase: {
    url: required('SUPABASE_URL'),
    serviceKey: required('SUPABASE_SERVICE_KEY'),
  },
  pix: {
    key: required('PIX_KEY'),
    merchantName: (process.env.PIX_MERCHANT_NAME || 'LOJA').toUpperCase(),
    merchantCity: (process.env.PIX_MERCHANT_CITY || 'BRASIL').toUpperCase(),
  },
  brandColor: parseInt(process.env.BRAND_COLOR || 'D4AF37', 16),
  // Identidade visual padronizada dos embeds (faixa/banner + rodapé com a marca).
  brand: (() => {
    const name = process.env.BRAND_NAME || 'MoonLight';
    return {
      name,
      bannerUrl: process.env.BRAND_BANNER_URL || null, // a "faixa" exibida embaixo dos embeds
      logoUrl: process.env.BRAND_LOGO_URL || null,     // ícone do rodapé (opcional)
      footer:
        process.env.BRAND_FOOTER ||
        `© ${new Date().getFullYear()} ${name} • Todos os direitos reservados.`,
    };
  })(),
};
