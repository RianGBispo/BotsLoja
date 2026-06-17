import { supabase } from '../lib/supabase.js';

// Normaliza o código para o formato armazenado: sem espaços e em MAIÚSCULAS.
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

// Mensagens amigáveis para cada motivo de recusa de validateCoupon().
export const COUPON_REASONS = {
  not_found: 'Cupom não encontrado. Confira o código e tente de novo.',
  inactive: 'Este cupom não está mais ativo.',
  expired: 'Este cupom expirou.',
  maxed: 'Este cupom atingiu o limite de usos.',
  no_discount: 'Este cupom não gera desconto neste carrinho.',
};

export async function getCouponByCode(code) {
  const norm = normalizeCode(code);
  if (!norm) return null;
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', norm)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listCoupons() {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .order('active', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createCoupon(c) {
  const { data, error } = await supabase
    .from('coupons')
    .insert({ ...c, code: normalizeCode(c.code) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Desativa o cupom (mantém o histórico de usos). Retorna o cupom, ou null se não existir/já inativo.
export async function deactivateCoupon(code) {
  const { data, error } = await supabase
    .from('coupons')
    .update({ active: false })
    .eq('code', normalizeCode(code))
    .eq('active', true)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Soma +1 no contador de usos. Chamado quando a equipe aprova o pedido.
export async function incrementCouponUses(code) {
  const coupon = await getCouponByCode(code);
  if (!coupon) return;
  const { error } = await supabase
    .from('coupons')
    .update({ uses: coupon.uses + 1 })
    .eq('id', coupon.id);
  if (error) throw error;
}

// Calcula o desconto em reais que o cupom dá sobre um subtotal. Nunca passa do subtotal.
export function discountFor(coupon, subtotal) {
  if (!coupon) return 0;
  const raw =
    coupon.type === 'percent'
      ? subtotal * (Number(coupon.value) / 100)
      : Number(coupon.value);
  const capped = Math.min(Math.max(raw, 0), subtotal);
  return Math.round(capped * 100) / 100;
}

// Valida um cupom para um subtotal. Retorna { ok, reason, discount }.
export function validateCoupon(coupon, subtotal) {
  if (!coupon) return { ok: false, reason: 'not_found' };
  if (!coupon.active) return { ok: false, reason: 'inactive' };
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (coupon.max_uses != null && coupon.uses >= coupon.max_uses) {
    return { ok: false, reason: 'maxed' };
  }
  const discount = discountFor(coupon, subtotal);
  if (discount <= 0) return { ok: false, reason: 'no_discount' };
  return { ok: true, discount };
}
