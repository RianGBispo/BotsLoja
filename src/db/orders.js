import { supabase } from '../lib/supabase.js';
import { getCouponByCode, validateCoupon } from './coupons.js';

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

// Adiciona itens ao carrinho. Se o produto já estiver no carrinho, soma na quantidade
// (uma unidade por vez que ele é escolhido); senão, insere com a qtd do lote.
//
// Usa a função SQL `add_order_item` (INSERT ... ON CONFLICT DO UPDATE) em vez de
// "ler → decidir → inserir/atualizar": o upsert é atômico, então cliques repetidos
// ou interações concorrentes para o mesmo produto não estouram a constraint
// unique(order_id, product_id) (erro 23505) — apenas somam na quantidade.
export async function addItems(orderId, products) {
  // Agrega duplicados do mesmo lote (ex.: o mesmo produto aparecendo duas vezes).
  const byId = new Map();
  for (const p of products) {
    const entry = byId.get(p.id) || { product: p, qty: 0 };
    entry.qty += 1;
    byId.set(p.id, entry);
  }

  for (const { product, qty } of byId.values()) {
    const { error } = await supabase.rpc('add_order_item', {
      p_order_id: orderId,
      p_product_id: product.id,
      p_unit_price: product.price,
      p_qty: qty,
    });
    if (error) throw error;
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

// Recalcula o pedido: subtotal dos itens, desconto do cupom aplicado e total a pagar.
// Se o cupom tiver expirado/esgotado/sumido desde que foi aplicado, ele é solto do
// pedido automaticamente (coupon_code volta a null, discount a 0).
export async function recalcTotal(orderId) {
  const items = await getOrderItems(orderId);
  const subtotal = items.reduce((s, i) => s + Number(i.unit_price) * i.qty, 0);

  const order = await getOrder(orderId);
  let couponCode = order.coupon_code || null;
  let discount = 0;
  let coupon = null;

  if (couponCode) {
    coupon = await getCouponByCode(couponCode);
    const res = validateCoupon(coupon, subtotal);
    if (res.ok) {
      discount = res.discount;
    } else {
      // Cupom não vale mais para este carrinho — solta do pedido.
      couponCode = null;
      coupon = null;
    }
  }

  const total = Math.round(Math.max(0, subtotal - discount) * 100) / 100;
  await updateOrder(orderId, { total, discount, coupon_code: couponCode });
  return { subtotal, discount, total, items, coupon };
}
