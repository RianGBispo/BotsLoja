import { supabase } from '../lib/supabase.js';

export async function listActiveProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getProduct(id) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('products').select('*').in('id', ids);
  if (error) throw error;
  return data;
}

export async function createProduct(p) {
  const { data, error } = await supabase.from('products').insert(p).select().single();
  if (error) throw error;
  return data;
}

// Remove do catálogo sem apagar de fato (mantém histórico de pedidos intacto).
export async function deactivateProductBySku(sku) {
  const { data, error } = await supabase
    .from('products')
    .update({ active: false })
    .eq('sku', sku)
    .eq('active', true)
    .select()
    .single();
  if (error) throw error;
  return data;
}
