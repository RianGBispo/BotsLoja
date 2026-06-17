# Arquitetura — Loja MoonLight

Documentação técnica do bot. Para instalação e uso, veja o [README](../README.md).

---

## Visão em camadas

```
Discord  ──interação──▶  index.js (evento InteractionCreate)
                              │
                              ▼
                    interactions/router.js   ── decide quem trata
                       │        │       │
                  commands   tickets  catalog/checkout/staff
                       │        │       │
                       ▼        ▼       ▼
              lib/ (embeds, components, pix, cartView, permissions)
                              │
                              ▼
              db/ (products, orders, sellers) ──▶ lib/supabase.js ──▶ Supabase
```

- **`src/index.js`** — cria o `Client` (intent `Guilds`), loga e encaminha todo
  `InteractionCreate` para o router.
- **`src/config.js`** — lê o `.env`, valida o que é obrigatório (lança erro cedo se faltar) e exporta
  um objeto `config` tipado por seção (`discord`, `supabase`, `pix`, `brandColor`).
- **`src/interactions/router.js`** — ponto único de roteamento. Identifica o tipo de interação
  (slash, botão, select, modal), separa o `customId` em `prefixo:arg` e chama o handler certo. Captura
  erros e responde de forma efêmera sem derrubar o processo.

---

## Convenção de `customId`

Todo componente usa o formato **`prefixo:dado`** (ex.: `approve:<orderId>`, `buy:<productId>`).
O router faz `parse(customId)` → `{ prefix, arg }` e despacha pelo `prefix`. Os prefixos ficam
centralizados em `IDS` (botões/selects de loja) e `TICKET_IDS` (tickets).

| Prefixo | Componente | Handler | Arg |
|---|---|---|---|
| `open_ticket` | botão (painel) | `tickets.handleOpenTicket` | — |
| `close_ticket` | botão (ticket) | `tickets.handleCloseTicket` | — |
| `claim_ticket` | botão (ticket) | `tickets.handleClaim` | — |
| `browse_catalog` | select (vitrine) | `catalog.handleBrowse` | — |
| `buy` | botão (card do ped) | `catalog.handleBuy` | productId |
| `open_catalog` | botão | `catalog.handleOpenCatalog` | — |
| `add_items` | select (carrinho) | `catalog.handleAddItems` | — |
| `clear_cart` | botão (carrinho) | `catalog.handleClearCart` | — |
| `checkout` | botão (carrinho) | `checkout.handleCheckout` | — |
| `paid_claim` | botão (Pix) | `staff.handlePaidClaim` | orderId |
| `copy_pix` | botão (Pix) | `staff.handleCopyPix` | orderId |
| `approve` | botão (equipe) | `staff.handleApprove` | orderId |
| `reject` | botão (equipe) | `staff.handleReject` | orderId |
| `reject_modal` | modal submit | `staff.handleRejectModal` | orderId |

---

## Responsabilidade de cada módulo

### `interactions/tickets.js`
- `getOrCreateTicketChannel(interaction)` — cria (ou reaproveita) o canal privado do usuário. Define
  os `permissionOverwrites` (só cliente + equipe veem), posta a mensagem de boas-vindas pedindo o
  **briefing** do ped, cria o pedido (`getOrCreateOrder`) e renderiza o carrinho. **Reutilizado** pelo
  botão "Abrir ticket" e pelo "Comprar". Identifica o ticket pelo `topic = ticket:<userId>`. A mensagem
  de boas-vindas traz os botões **Assumir atendimento** e **Fechar ticket**.
- `handleOpenTicket` / `handleCloseTicket` — entradas dos botões do painel/ticket.
- `handleClaim` — botão **Assumir atendimento**. A sócia (equipe + cadastrada em `sellers`) que clicar
  vira a recebedora do Pix: grava `orders.claimed_by`, avisa no ticket e desabilita o botão ("Assumido por
  Ana"). É o que define **em qual chave Pix** o checkout vai gerar a cobrança.

### `interactions/catalog.js`
- `handleBrowse` — no select da vitrine, responde **efêmero** com o card do ped + botão Comprar.
- `handleBuy` — abre/usa o ticket, adiciona o ped ao pedido e atualiza o carrinho.
- `handleAddItems` — adiciona vários peds de uma vez pelo select do carrinho.
- `handleClearCart` — esvazia o carrinho.
- `handleOpenCatalog` — (re)mostra o carrinho dentro do ticket.

### `interactions/checkout.js`
- `handleCheckout` — resolve a **vendedora que assumiu** (`claimed_by` → `getSellerByDiscordId`); se
  ninguém assumiu, **bloqueia** e pede pra aguardar (o Pix nunca cai em conta errada). Senão calcula o
  total, gera o `txid` (`MN` + `order_number`), monta o **Pix Copia e Cola** **com a chave da sócia** e a
  **imagem do QR** (anexo `pix.png`), marca o pedido como `pending_payment`, remove a mensagem do carrinho
  editável e posta o embed do Pix (com "Pagamento para: <nome>") com os botões do cliente.

### `interactions/staff.js`
- `handlePaidClaim` — botão do **cliente**; valida que quem clicou é o comprador (ou equipe), marca
  `awaiting_review` e posta a chamada para a equipe (`@cargo`) com os botões de validação.
- `handleApprove` — exige cargo da equipe; marca `paid`, avisa o cliente, registra a venda em `#vendas`
  (com o campo **Recebido por** = quem assumiu), pede o anexo do arquivo e **desabilita** os botões.
- `handleReject` — abre o modal de motivo.
- `handleRejectModal` — grava o motivo, marca `rejected` e avisa o cliente.
- `handleCopyPix` — reenvia o Copia e Cola em texto (efêmero), gerado na **chave da sócia que assumiu**.

### `lib/`
- **`pix.js`** — `gerarPixCopiaECola({ key, amount, merchantName, merchantCity, txid })` retorna o BR Code.
  Inclui montagem TLV, sanitização (sem acento/caracteres inválidos) e CRC16-CCITT.
- **`embeds.js`** — `brandEmbed({ banner, footer })` é o **molde visual** (cor da marca + faixa/banner
  embaixo + rodapé com `config.brand`); todos os embeds começam por ele. `productEmbed`, `cartEmbed`,
  `pixEmbed`, `saleEmbed` e o helper `brl()` (formata R$). `banner: false` nos embeds que já usam a imagem
  principal pra outra coisa (QR do Pix, preview do ped).
- **`components.js`** — `IDS`, e builders: `buyButtonRow`, `browseCatalogRow`, `catalogSelectRow`,
  `cartActionsRow`, `pixBuyerRow`, `staffActionsRow`, `openCatalogRow`.
- **`cartView.js`** — `buildCartPayload` (embed + menu + ações) e `refreshCartMessage` (edita a mensagem
  existente do carrinho ou cria uma nova, guardando `cart_message_id`).
- **`permissions.js`** — `isStaff(member)` confere o `STAFF_ROLE_ID`.
- **`supabase.js`** — cliente com a service key (`persistSession: false`).

### `db/`
- **`products.js`** — `listActiveProducts`, `getProduct`, `getProductsByIds`, `createProduct`.
- **`orders.js`** — `getOpenOrderByChannel`, `getOrCreateOrder`, `updateOrder`, `getOrderItems`,
  `addItems` (ignora duplicados e recalcula), `removeItem`, `recalcTotal`.
- **`sellers.js`** — `getSellerByDiscordId(discordUserId)`: retorna a sócia **ativa** ligada àquele
  usuário do Discord (ou `null`). É daqui que sai a chave Pix de quem assumiu o ticket.

---

## Sequência de uma compra (resumo)

```
cliente: select "browse_catalog"  → handleBrowse → card efêmero + [Comprar]
cliente: botão "buy:<id>"          → handleBuy   → cria ticket + add item + carrinho
sócia  : botão "claim_ticket"      → handleClaim  → grava claimed_by (quem recebe o Pix)
(atendimento: cliente descreve o ped, equipe alinha valor)
cliente: select "add_items"        → handleAddItems → atualiza carrinho
cliente: botão "checkout"          → handleCheckout  → Pix na chave da sócia, status=pending_payment
cliente: anexa comprovante + botão "paid_claim:<order>" → handlePaidClaim → status=awaiting_review + @equipe
equipe : botão "approve:<order>"   → handleApprove → status=paid, avisa cliente, #vendas, pede anexo
   (ou)  botão "reject:<order>"    → modal → handleRejectModal → status=rejected + motivo
equipe : anexa o arquivo no ticket → entrega manual
```

---

## Decisões de projeto

- **Sem intents privilegiados**: dados do membro (cargos) vêm na própria interação; não é preciso ler
  conteúdo de mensagens. Por isso a detecção do comprovante é por **ação do cliente** ("Já paguei"),
  não por leitura automática de anexos.
- **Quantidade por item = 1**: o carrinho é por seleção; um mesmo ped não duplica (`unique(order_id, product_id)`).
- **Preço com snapshot**: `order_items.unit_price` guarda o preço no momento da compra; alterar o produto
  depois não muda pedidos antigos.
- **Tickets nativos**: criados pelo próprio bot (sem plugin externo), 1 por usuário, identificados pelo `topic`.
- **`txid` legível**: `MN` + `order_number` para casar com o extrato bancário.
- **Quem assume recebe**: não há conta da empresa. Cada sócia tem sua chave em `sellers`; ao **assumir**
  o ticket, o Pix daquele pedido é gerado na chave dela (`claimed_by`). Adicionar gente nova = inserir uma
  linha em `sellers`, sem mexer no código. Produtos feitos em dupla são acertados entre as sócias por fora.
