import { supabase } from '../lib/supabase.js';

// Retorna a vendedora (sócia) ativa ligada a este usuário do Discord, ou null.
// É a partir daqui que o checkout descobre a chave Pix de quem assumiu o ticket.
export async function getSellerByDiscordId(discordUserId) {
  if (!discordUserId) return null;
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('discord_user_id', discordUserId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}
