import { supabase } from '../lib/supabase.js';

// Retorna o pedido aberto (carrinho/pagamento) do ticket, ou null.
export async function getOpenOrderByChannel(channelId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('channel_id', channelId)
    .in('status', ['cart', 'pending_payment'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrder(id) {
  const { data, error } = await supabase.from('orders').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createOrder({ discordUserId, channelId }) {
  const { data, error } = await supabase
    .from('orders')
    .insert({ discord_user_id: discordUserId, channel_id: channelId, status: 'cart', total: 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Cria o pedido se não existir um aberto no ticket.
export async function getOrCreateOrder({ discordUserId, channelId }) {
  const existing = await getOpenOrderByChannel(channelId);
  if (existing) return existing;
  return createOrder({ discordUserId, channelId });
}

export async function updateOrder(id, patch) {
  const { data, error } = await supabase.from('orders').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ---------- Itens ----------

export async function getOrderItems(orderId) {
  const { data, error } = await supabase
    .from('order_items')
    .select('*, product:products(*)')
    .eq('order_id', orderId);
  if (error) throw error;
  return data;
}

// Adiciona itens ao carrinho. Se o produto já estiver no carrinho, soma +1 na
// quantidade (uma unidade por vez que ele é escolhido); senão, insere com qty 1.
export async function addItems(orderId, products) {
  const existing = await getOrderItems(orderId);
  const byProduct = new Map(existing.map((i) => [i.product_id, i]));

  for (const p of products) {
    const current = byProduct.get(p.id);
    if (current) {
      const { error } = await supabase
        .from('order_items')
        .update({ qty: current.qty + 1 })
        .eq('id', current.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('order_items')
        .insert({ order_id: orderId, product_id: p.id, unit_price: p.price, qty: 1 });
      if (error) throw error;
    }
  }
  return recalcTotal(orderId);
}

// Define a quantidade exata de um item. qty <= 0 remove o item do carrinho.
export async function setItemQty(orderId, productId, qty) {
  if (!Number.isInteger(qty) || qty <= 0) {
    return removeItem(orderId, productId);
  }
  const { error } = await supabase
    .from('order_items')
    .update({ qty })
    .eq('order_id', orderId)
    .eq('product_id', productId);
  if (error) throw error;
  return recalcTotal(orderId);
}

export async function removeItem(orderId, productId) {
  const { error } = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', orderId)
    .eq('product_id', productId);
  if (error) throw error;
  return recalcTotal(orderId);
}

export async function recalcTotal(orderId) {
  const items = await getOrderItems(orderId);
  const total = items.reduce((s, i) => s + Number(i.unit_price) * i.qty, 0);
  await updateOrder(orderId, { total });
  return { total, items };
}
