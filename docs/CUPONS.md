# Cupons de desconto — Loja MoonLight

Documentação do sistema de cupons: como o cliente usa, como a equipe cria/gerencia, como o desconto é
calculado e onde cada parte vive no código. Para a visão geral do bot, veja o [README](../README.md) e a
[Arquitetura](ARQUITETURA.md).

---

## Visão geral

Um **cupom** dá desconto no carrinho. O **cliente** aplica o código no próprio ticket (botão no
carrinho); a **equipe** cria e gerencia os cupons por comandos slash. O desconto entra no cálculo do
pedido e o **Pix é gerado já com o valor com desconto**.

- **Dois tipos:** porcentagem (`percent`) ou valor fixo em reais (`fixed`).
- **Regras opcionais:** data de validade (`expires_at`) e limite de usos (`max_uses`).
- **Uso contado só na aprovação:** carrinhos abandonados não gastam usos.
- **Auto-soltura:** cupom que expira/esgota enquanto está no carrinho é removido sozinho no próximo
  recálculo (e no checkout), evitando gerar Pix com desconto indevido.

---

## Fluxo do cliente

```
carrinho  ── botão "🏷️ Aplicar cupom"  → abre modal (coupon_modal)
modal     ── digita o código           → valida → aplica desconto e re-renderiza o carrinho
carrinho  ── mostra Subtotal / Desconto / Total + botão "Remover cupom"
checkout  ── "Finalizar e gerar Pix"   → revalida o cupom → Pix com o total já com desconto
```

1. No carrinho, ao lado de **Finalizar e gerar Pix**, aparece **🏷️ Aplicar cupom** (vira **Trocar cupom**
   quando já há um aplicado).
2. O cliente digita o código num modal. O bot valida e, se ok, abate o desconto. O embed do carrinho
   passa a exibir **Subtotal**, **Desconto (CÓDIGO)** e **Total**.
3. Enquanto há um cupom aplicado, surge o botão **Remover cupom**.
4. No checkout, o cupom é revalidado: se ainda vale, o **Pix sai com o total com desconto**; se caducou
   nesse meio-tempo, ele é solto e o Pix sai pelo valor cheio (o cliente vê o carrinho atualizado).

---

## Fluxo da equipe (comandos slash)

Todos exigem **Gerenciar Servidor**.

| Comando | O que faz | Opções |
|---|---|---|
| `/cupom-add` | Cria um cupom | `codigo`, `tipo` (`percent`/`fixed`), `valor` (obrigatórias); `expira` (AAAA-MM-DD), `limite` (inteiro) opcionais |
| `/cupom-remover` | Desativa um cupom (autocomplete dos ativos) | `codigo` |
| `/cupom-listar` | Lista todos (ativos 🟢 / inativos ⚪) com valor, validade e usos | — |

**Exemplos:**

- `10%` para os 50 primeiros, válido até o fim de 2026:
  `/cupom-add codigo:BLACK10 tipo:Porcentagem valor:10 expira:2026-12-31 limite:50`
- `R$ 20` fixo, sem validade nem limite:
  `/cupom-add codigo:BEMVINDO tipo:Valor fixo valor:20`

> O `codigo` é sempre normalizado para MAIÚSCULAS. Desativar mantém o histórico de usos; o cupom só
> some da validação (não pode mais ser aplicado).

---

## Como o desconto é calculado

Centralizado em `db/orders.js` → `recalcTotal(orderId)`, chamado a cada mudança do carrinho e no checkout:

```
subtotal = Σ (unit_price × qty)                      // soma dos itens
discount = desconto do cupom aplicado, se válido      // ver discountFor()
total    = max(0, subtotal − discount)                // valor a pagar (vira o Pix)
```

- **`discountFor(coupon, subtotal)`** (em `db/coupons.js`):
  - `percent` → `subtotal × (value / 100)`
  - `fixed` → `value`
  - O resultado é **limitado ao subtotal** (o desconto nunca deixa o total negativo) e arredondado a 2 casas.
- A cada recálculo o cupom é **revalidado** (`validateCoupon`). Se não passa mais (inativo, expirado,
  esgotado ou removido), o `coupon_code` volta a `null` e o `discount` a `0` no pedido.

### Validação — `validateCoupon(coupon, subtotal)`

Retorna `{ ok, reason, discount }`. Motivos de recusa (mapeados em `COUPON_REASONS` para texto amigável):

| `reason` | Quando | Mensagem ao cliente |
|---|---|---|
| `not_found` | código não existe | Cupom não encontrado. Confira o código e tente de novo. |
| `inactive` | `active = false` | Este cupom não está mais ativo. |
| `expired` | `expires_at` no passado | Este cupom expirou. |
| `maxed` | `uses >= max_uses` | Este cupom atingiu o limite de usos. |
| `no_discount` | desconto resultaria em 0 (ex.: carrinho vazio) | Este cupom não gera desconto neste carrinho. |

### Contagem de usos

O contador `uses` **só sobe quando a equipe aprova o pedido** (`staff.handleApprove` →
`incrementCouponUses`). Assim, carrinhos abandonados ou pagamentos recusados não consomem o limite.

### Pedido gratuito (cupom cobre o total)

Quando o desconto zera o pedido (`total <= 0`) — um cupom de **100%** ou um cupom fixo **≥ subtotal** — o
gerador de Pix EMV **não aceita valor 0** e daria erro. Então o checkout (`checkout.handleCheckout`) desvia
para `finalizeFreeOrder`:

- **Não gera QR Code nem Pix Copia e Cola.**
- **Não exige sócia** (`claimed_by`): como não há valor a receber, o pedido não depende de quem assumiu.
- Marca o pedido direto como **`awaiting_review`** (pula `pending_payment`), remove o carrinho editável e
  posta o `freeOrderEmbed` chamando a equipe (`@cargo`) com os botões **Aprovar / Recusar** — o botão
  **Copiar Pix** é omitido (`staffActionsRow(orderId, { withPix: false })`).
- A aprovação segue o fluxo normal: a equipe anexa o arquivo, o pedido vira `paid`, a venda é registrada em
  `#vendas` (total R$ 0,00) e o **uso do cupom é contabilizado** como em qualquer venda.

---

## Modelo de dados

Tabela **`coupons`** (ver [supabase/schema.sql](../supabase/schema.sql)):

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid | PK |
| `code` | text | único, MAIÚSCULAS (ex.: `BEMVINDO10`) |
| `type` | text | `percent` ou `fixed` |
| `value` | numeric(10,2) | `> 0`. Para `percent`, é a %; para `fixed`, reais |
| `expires_at` | timestamptz | nulo = nunca expira |
| `max_uses` | integer | nulo = ilimitado; senão `> 0` |
| `uses` | integer | default 0; sobe na aprovação |
| `active` | boolean | default true |
| `created_at` | timestamptz | default now() |

Colunas adicionadas em **`orders`**:

| Coluna | Tipo | Observação |
|---|---|---|
| `coupon_code` | text | cupom aplicado ao pedido (nulo = sem cupom) |
| `discount` | numeric(10,2) | desconto em reais já calculado (default 0) |

> `orders.total` continua sendo o **valor a pagar** (subtotal − discount). É ele que vira o valor do Pix.

---

## Onde cada parte vive

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Dados | [src/db/coupons.js](../src/db/coupons.js) | `normalizeCode`, `getCouponByCode`, `listCoupons`, `createCoupon`, `deactivateCoupon`, `incrementCouponUses`, `discountFor`, `validateCoupon`, `COUPON_REASONS` |
| Dados | [src/db/orders.js](../src/db/orders.js) | `recalcTotal` aplica/solta o cupom e devolve `{ subtotal, discount, total, items, coupon }` |
| Interação | [src/interactions/coupons.js](../src/interactions/coupons.js) | `handleApplyCoupon` (abre modal), `handleCouponModal` (valida/aplica), `handleRemoveCoupon` |
| Interação | [src/interactions/checkout.js](../src/interactions/checkout.js) | usa `recalcTotal` para o Pix já com desconto; `finalizeFreeOrder` trata pedido zerado (sem QR/Pix) |
| Interação | [src/interactions/staff.js](../src/interactions/staff.js) | `handleApprove` chama `incrementCouponUses` |
| Comandos | [src/commands.js](../src/commands.js) | `/cupom-add`, `/cupom-remover`, `/cupom-listar` + autocomplete |
| Visual | [src/lib/components.js](../src/lib/components.js) | `cartActionsRow(hasItems, hasCoupon)`, `couponModal(currentCode)`, `staffActionsRow(orderId, { withPix })`, IDs `applyCoupon`/`removeCoupon`/`couponModal`/`couponInput` |
| Visual | [src/lib/embeds.js](../src/lib/embeds.js) | `cartEmbed`/`pixEmbed`/`saleEmbed` exibem subtotal, desconto e cupom; `freeOrderEmbed` para pedido gratuito |
| Visual | [src/lib/cartView.js](../src/lib/cartView.js) | `buildCartPayload` repassa desconto/cupom ao embed e aos botões |

### Convenção de `customId` (cupons)

| Prefixo | Componente | Handler | Arg |
|---|---|---|---|
| `apply_coupon` | botão (carrinho) | `coupons.handleApplyCoupon` | — |
| `remove_coupon` | botão (carrinho) | `coupons.handleRemoveCoupon` | — |
| `coupon_modal` | modal submit | `coupons.handleCouponModal` | — |

---

## Instalação / migração

1. **Banco:** rode o [supabase/schema.sql](../supabase/schema.sql) de novo no SQL Editor. É idempotente:
   cria a tabela `coupons` e adiciona `coupon_code`/`discount` em `orders` sem afetar dados existentes.
2. **Comandos:** `npm run deploy-commands` para registrar os `/cupom-*`, depois reinicie o bot.

---

## Decisões de projeto

- **Cliente aplica, equipe gerencia.** O código fica do lado do cliente (modal no carrinho); a criação é
  restrita a quem tem Gerenciar Servidor.
- **`total` continua sendo o valor a pagar.** Em vez de uma coluna de subtotal, guardamos `discount` e
  derivamos o subtotal por soma (`total + discount`) na exibição — menos colunas para manter em sincronia.
- **Recálculo é a fonte da verdade.** Em vez de "travar" o desconto no momento da aplicação, ele é
  recalculado e revalidado a cada mudança do carrinho e no checkout, então mudanças de itens, expiração
  ou esgotamento são sempre refletidas antes de gerar o Pix.
- **Uso conta na aprovação.** Garante que o limite reflita vendas reais, não tentativas.
- **Desconto limitado ao subtotal.** Um cupom fixo maior que o carrinho zera o total, nunca fica negativo.
