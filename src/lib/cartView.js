import { cartEmbed } from './embeds.js';
import { catalogSelectRow, editQtyRow, cartActionsRow } from './components.js';
import { listActiveProducts } from '../db/products.js';
import { getOrderItems, recalcTotal, updateOrder } from '../db/orders.js';

// Monta o payload (embed + componentes) da mensagem do carrinho.
export async function buildCartPayload(order) {
  const { items, total } = await recalcTotal(order.id);
  const orderWithTotal = { ...order, total };
  const products = await listActiveProducts();
  const hasItems = items.length > 0;

  const components = [catalogSelectRow(products)];
  if (hasItems) components.push(editQtyRow(items));
  components.push(cartActionsRow(hasItems));

  return {
    embeds: [cartEmbed(orderWithTotal, items)],
    components,
  };
}

// Re-renderiza o carrinho: edita a mensagem existente ou cria uma nova.
export async function refreshCartMessage(channel, order) {
  const payload = await buildCartPayload(order);

  if (order.cart_message_id) {
    try {
      const msg = await channel.messages.fetch(order.cart_message_id);
      await msg.edit(payload);
      return msg;
    } catch {
      // mensagem apagada — cria de novo
    }
  }

  const msg = await channel.send(payload);
  await updateOrder(order.id, { cart_message_id: msg.id });
  return msg;
}

export { getOrderItems };
