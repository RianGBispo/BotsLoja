# Loja MoonLight — Bot de Loja para Discord (RedM/peds)

Bot de loja sob encomenda para Discord, com **R$ 0 de mensalidade e 0% de taxa por venda**.
O cliente abre um atendimento, descreve o ped que quer, fecha o pedido, paga via **Pix
(QR Code + Copia e Cola gerados localmente, sem gateway)**, anexa o comprovante, e a equipe
**valida manualmente** e entrega o arquivo no próprio ticket.

> **Por que custo zero?** O Pix é gerado no próprio bot (padrão EMV/BR Code do Banco Central) e cai
> direto na sua conta como transferência comum. A confirmação é manual (você confere o comprovante),
> então não há API bancária paga. Discord e Supabase rodam no plano gratuito.

---

## Índice

- [Visão geral do fluxo](#visão-geral-do-fluxo)
- [Stack](#stack)
- [Pré-requisitos](#pré-requisitos)
- [Setup passo a passo](#setup-passo-a-passo)
- [Cadastrar as sócias (vendedoras)](#cadastrar-as-sócias-vendedoras)
- [Variáveis de ambiente (.env)](#variáveis-de-ambiente-env)
- [Comandos slash](#comandos-slash)
- [Estados de um pedido](#estados-de-um-pedido)
- [Banco de dados](#banco-de-dados)
- [Como o Pix é gerado](#como-o-pix-é-gerado)
- [Rodar em produção](#rodar-em-produção)
- [Solução de problemas](#solução-de-problemas)
- [Segurança](#segurança)
- [Documentação técnica](#documentação-técnica)

---

## Visão geral do fluxo

**Lado do cliente:**

1. No canal de catálogo (`/vitrine`), escolhe um ped no **menu suspenso** → vê o card (preço, imagem) só pra ele.
2. Clica em **Comprar** → o bot **cria um ticket individual** automaticamente e manda uma mensagem
   pedindo os **detalhes do ped** (referências, cores, MP/SP, observações). O atendimento começa aqui.
   *(Alternativa: clicar em **Abrir ticket** no painel `/painel` e montar o carrinho lá dentro.)*
3. Fechados os detalhes e o valor com a equipe, usa o **menu do carrinho** para adicionar peds e clica
   em **Finalizar e gerar Pix**.
4. O bot mostra o **QR Code + Pix Copia e Cola**. O cliente paga, **anexa o comprovante** no ticket e
   clica em **Já paguei (enviar comprovante)**.

**Lado da equipe:**

> **Quem assume o atendimento recebe o Pix.** A loja não tem conta única: cada sócia tem sua própria
> chave (tabela `sellers`). Durante o atendimento, a sócia clica em **Assumir atendimento** no ticket —
> a partir daí o Pix daquele pedido é gerado **na chave dela**. Sem ninguém assumir, o bot não gera o Pix
> e pede pra aguardar. Veja [Cadastrar as sócias](#cadastrar-as-sócias-vendedoras).

5. Ao clicar em "Já paguei", o bot **marca o pedido como *aguardando revisão* e chama a equipe** (`@cargo`)
   com os botões **Aprovar / Recusar / Copiar Pix**.
6. A equipe confere o comprovante e:
   - **Aprovar** → o bot confirma o pagamento ao cliente, marca como pago, registra a venda em `#vendas`
     e pede para a equipe **anexar o arquivo** ali no ticket. Você arrasta o arquivo e pronto.
   - **Recusar** → abre um modal pedindo o motivo; o cliente é avisado e o ticket **continua aberto**.

---

## Stack

- [discord.js](https://discord.js.org) v14 — embeds, botões, select menus, modais, tickets.
- [Supabase](https://supabase.com) (free tier) — produtos, pedidos e itens.
- [qrcode](https://www.npmjs.com/package/qrcode) — gera a imagem do QR do Pix localmente.
- Gerador de Pix EMV/BR Code próprio ([src/lib/pix.js](src/lib/pix.js)) — sem dependências externas, sem cadastro.

Sem servidor web, sem Apache, sem gateway de pagamento.

---

## Pré-requisitos

1. **Node.js 20+** (`node --version`).
2. **Uma aplicação/bot no Discord** ([Developer Portal](https://discord.com/developers/applications)):
   - Copie o **Token** (aba *Bot*) e o **Application ID** (aba *General Information*).
   - **Não precisa de intents privilegiados** — o bot usa só o intent `Guilds`.
3. **Convidar o bot** para o servidor com as permissões abaixo (escopo `bot` + `applications.commands`).
4. **Um projeto no Supabase** (gratuito) — URL e *secret key* (service_role).

### Permissões do bot no servidor

O cargo do bot precisa de: **Ver Canais, Enviar Mensagens, Inserir Links (Embed), Anexar Arquivos,
Ler Histórico, Gerenciar Mensagens** (apagar o carrinho ao gerar o Pix), **Gerenciar Canais** e
**Gerenciar Cargos** (criar tickets e definir quem vê o canal), e **Marcar @everyone/cargos** *(ou
deixe o cargo da equipe como "mencionável")* — para o `@equipe` funcionar ao chamar pra validar.

> Para testar rápido, dar **Administrador** ao cargo do bot evita qualquer erro de permissão.

---

## Setup passo a passo

```bash
# 1. Dependências
npm install

# 2. Configuração: copie e preencha o .env
cp .env.example .env

# 3. Banco: no Supabase → SQL Editor, rode o conteúdo de supabase/schema.sql

# 4. Registre os comandos slash no seu servidor
npm run deploy-commands

# 5. Suba o bot
npm run bot
```

Depois, dentro do Discord (como admin): cadastre peds com `/produto-add`, publique a vitrine com
`/vitrine` e o painel de tickets com `/painel`. Por fim, [cadastre as sócias](#cadastrar-as-sócias-vendedoras).

---

## Cadastrar as sócias (vendedoras)

Como **quem assume o ticket recebe o Pix**, cada sócia precisa de uma linha na tabela `sellers` com a
chave dela. Sem cadastro, o botão **Assumir atendimento** recusa e o Pix não é gerado.

No Supabase → **SQL Editor**, rode (troque pelos dados reais):

```sql
insert into sellers (discord_user_id, name, pix_key, merchant_name, merchant_city) values
  ('ID_DISCORD_DA_ANA', 'Ana', 'ana@email.com', 'ANA SOBRENOME', 'CUIABA'),
  ('ID_DISCORD_DA_BIA', 'Bia', '06599999999',   'BIA SOBRENOME', 'CUIABA');
```

- **`discord_user_id`** — ative o *Modo Desenvolvedor* no Discord (Configurações → Avançado), clique com
  o botão direito no nome da pessoa → **Copiar ID**.
- **`merchant_name`** (máx. 25) e **`merchant_city`** (máx. 15) — sem acento; aparecem no recibo do Pix.
- Para **adicionar alguém no futuro**: basta um novo `insert`. Para afastar temporariamente: `update
  sellers set active = false where ...` (some da lista de quem pode assumir, sem perder o histórico).

> Produtos feitos por **duas sócias juntas**: o bot não divide — quem assumiu recebe o valor cheio e o
> acerto entre elas é feito por fora. (Se um dia quiserem split automático, é uma evolução possível.)

---

## Variáveis de ambiente (.env)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DISCORD_TOKEN` | sim | Token do bot (Developer Portal → Bot). |
| `DISCORD_CLIENT_ID` | sim | Application ID da aplicação. |
| `GUILD_ID` | sim | ID do servidor onde os comandos são registrados. |
| `STAFF_ROLE_ID` | sim | Cargo da equipe (quem pode aprovar/recusar). |
| `TICKET_CATEGORY_ID` | não | Categoria onde os tickets são criados. |
| `CATALOG_CHANNEL_ID` | não | Canal onde `/vitrine` publica o catálogo. Se vazio, publica no canal atual. |
| `SALES_CHANNEL_ID` | não | Canal `#vendas` para registrar as vendas aprovadas. |
| `SUPABASE_URL` | sim | URL do projeto Supabase. |
| `SUPABASE_SERVICE_KEY` | sim | **Secret key** (service_role). Só no servidor, nunca no front. |
| `PIX_KEY` | sim¹ | Legado. As chaves de cobrança hoje vêm da tabela `sellers` (quem assume recebe). Ainda exigido no boot. |
| `PIX_MERCHANT_NAME` | não | Legado (idem `PIX_KEY`). O nome do recebedor vem de `sellers.merchant_name`. |
| `PIX_MERCHANT_CITY` | não | Legado (idem `PIX_KEY`). A cidade vem de `sellers.merchant_city`. |
| `BRAND_COLOR` | não | Cor dos embeds em hex sem `#` (padrão `D4AF37`). |
| `BRAND_NAME` | não | Nome da marca no rodapé e títulos (padrão `MoonLight`). |
| `BRAND_BANNER_URL` | não | URL da **faixa/banner** exibida embaixo das mensagens (~960px de largura). Vazio = sem faixa. |
| `BRAND_LOGO_URL` | não | URL do ícone do rodapé (opcional). Vazio = sem ícone. |
| `BRAND_FOOTER` | não | Texto do rodapé. Vazio = `© <ano> <BRAND_NAME> • Todos os direitos reservados.` |

> ¹ `PIX_KEY` não é mais usado para gerar cobranças (cada Pix sai da chave da sócia que assumiu), mas
> `config.js` ainda o valida na inicialização. Pode deixar qualquer valor válido enquanto não for removido.

---

## Comandos slash

Todos exigem a permissão **Gerenciar Servidor** (definida em cada comando).

| Comando | O que faz |
|---|---|
| `/painel` | Posta o painel público com o botão **Abrir ticket**. |
| `/vitrine` | Publica **um embed + menu suspenso** com todos os peds no `CATALOG_CHANNEL_ID` (ou no canal atual). |
| `/produto-add` | Cadastra um ped. Opções: `sku`, `nome`, `preco` (obrigatórias) e `descricao`, `categoria`, `compatibilidade`, `imagem` (opcionais). |
| `/produto-remover` | Tira um ped do catálogo (autocomplete pelo nome/SKU). Pedidos antigos ficam intactos. |
| `/cupom-add` | Cria um cupom de desconto. Opções: `codigo`, `tipo` (% ou R$ fixo), `valor` (obrigatórias) e `expira` (AAAA-MM-DD), `limite` de usos (opcionais). |
| `/cupom-remover` | Desativa um cupom (autocomplete pelos cupons ativos). O histórico de usos é mantido. |
| `/cupom-listar` | Lista os cupons cadastrados (ativos/inativos), com valor, validade e usos. |

> Se você cadastrar/alterar peds, rode `/vitrine` de novo para republicar o menu atualizado.

### Cupons de desconto

O cliente aplica o cupom no próprio carrinho: há um botão **🏷️ Aplicar cupom** ao lado de **Finalizar
e gerar Pix**. Ele digita o código num modal; o bot valida (existe? está ativo? expirou? estourou o
limite de usos?) e, se ok, abate o desconto — o carrinho passa a mostrar **subtotal, desconto e total**, e
o **Pix é gerado já com o valor com desconto**. Um botão **Remover cupom** aparece enquanto há um aplicado.

- **Tipos:** porcentagem (`10` = 10%) ou valor fixo em reais (`20` = R$ 20). O desconto nunca passa do subtotal.
- **Validade e limite são opcionais.** Sem eles, o cupom vale sempre e para qualquer número de vendas.
- **O uso só é contabilizado quando a equipe APROVA o pedido** — carrinhos abandonados não gastam usos.
- Se um cupom expirar/esgotar enquanto está no carrinho, o bot o **solta automaticamente** no próximo
  recálculo (e no checkout), evitando gerar um Pix com desconto indevido.

---

## Estados de um pedido

Cada ticket tem **um** pedido. A coluna `status` em `orders` evolui assim:

```
cart ──(Finalizar e gerar Pix)──▶ pending_payment ──(cliente: "Já paguei")──▶ awaiting_review
                                                                                     │
                                                          equipe: Aprovar ──▶ paid   │
                                                          equipe: Recusar ──▶ rejected
```

- **cart** — carrinho em montagem.
- **pending_payment** — Pix gerado, aguardando o cliente pagar.
- **awaiting_review** — cliente anexou comprovante e avisou; aguardando a equipe.
- **paid** — equipe aprovou; arquivo é entregue manualmente no ticket.
- **rejected** — equipe recusou (com motivo); ticket segue aberto.
- `delivered` e `cancelled` existem no schema, reservados para uso futuro.

---

## Banco de dados

Schema completo em [supabase/schema.sql](supabase/schema.sql). Cinco tabelas:

- **products** — peds do catálogo: `sku`, `name`, `description`, `price`, `category`,
  `compatibility`, `image_url`, `active`.
- **sellers** — sócias/vendedoras: `discord_user_id` (quem assume), `name`, `pix_key`, `merchant_name`,
  `merchant_city`, `active`. Veja [Cadastrar as sócias](#cadastrar-as-sócias-vendedoras).
- **orders** — pedidos: `order_number` (vira o `txid` `MN0042`), `discord_user_id`, `channel_id`,
  `cart_message_id`, `status`, `total` (já com desconto), `discount`, `coupon_code`, `pix_txid`,
  `claimed_by` (sócia que assumiu/recebe), `reject_reason`, `approved_by`.
- **order_items** — itens do carrinho: `order_id`, `product_id`, `unit_price` (snapshot), `qty`.
- **coupons** — cupons de desconto: `code`, `type` (`percent`/`fixed`), `value`, `expires_at`,
  `max_uses`, `uses`, `active`. Criados pela equipe com `/cupom-add`.

### Migração (se já rodou um schema antigo)

Caso já tivesse criado as tabelas antes do status `awaiting_review` existir:

```sql
alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('cart','pending_payment','awaiting_review','paid','delivered','rejected','cancelled'));
```

Para o modelo "quem assume recebe" (tabela `sellers` + coluna `claimed_by`) — basta rodar o
`supabase/schema.sql` atualizado de novo: ele cria a tabela `sellers` e adiciona `claimed_by` de forma
idempotente (`create table if not exists` + `alter table ... add column if not exists`), sem afetar o
que já existe. Depois, [cadastre as sócias](#cadastrar-as-sócias-vendedoras).

Para os **cupons de desconto** (tabela `coupons` + colunas `coupon_code`/`discount` em `orders`) — idem:
rode o `supabase/schema.sql` atualizado de novo. Ele cria a tabela `coupons` e adiciona as colunas em
`orders` de forma idempotente, sem afetar pedidos existentes. Depois é só registrar os comandos
(`npm run deploy-commands`) para os novos `/cupom-*` aparecerem no Discord.

---

## Como o Pix é gerado

[src/lib/pix.js](src/lib/pix.js) monta o **BR Code** no padrão EMV®QRCPS do Banco Central:
campos TLV (id+tamanho+valor), chave Pix, valor, nome/cidade do recebedor, `txid` e **CRC16-CCITT**.
A string resultante é o "Copia e Cola"; o QR é só essa string renderizada como imagem (lib `qrcode`).
O `txid` (ex.: `MN0042`, derivado do `order_number`) liga o pagamento ao pedido no seu extrato.

A **chave, nome e cidade** usados na cobrança vêm da **sócia que assumiu o ticket** (`orders.claimed_by`
→ tabela `sellers`), não de um valor global. Por isso o checkout só gera o Pix depois que alguém assume.

---

## Rodar em produção

O `npm run bot` precisa ficar rodando. Em um servidor, use um gerenciador de processo, ex. PM2:

```bash
npm i -g pm2
pm2 start src/index.js --name loja-bot
pm2 save && pm2 startup    # reinicia junto com o sistema
pm2 logs loja-bot          # acompanhar logs
```

**Hospedar na nuvem (Fly.io):** há um guia completo de deploy (Docker + secrets + comandos)
em **[DEPLOY-FLY.md](DEPLOY-FLY.md)** — sobe o bot 24/7 sem precisar de servidor próprio.

---

## Solução de problemas

| Sintoma | Causa provável / solução |
|---|---|
| Bot não loga / "disallowed intents" | Token errado, ou intents privilegiados ligados sem necessidade. O bot só usa `Guilds`. |
| Comandos `/` não aparecem | Rode `npm run deploy-commands`; confira `DISCORD_CLIENT_ID` e `GUILD_ID`; o bot precisa estar no servidor. |
| "Abrir ticket"/"Comprar" falha | Falta **Gerenciar Canais/Cargos** ao bot, ou `TICKET_CATEGORY_ID` inválido. |
| O `@equipe` não notifica | Dê **Marcar Cargos** ao bot, ou deixe o cargo da equipe como mencionável. |
| Erro ao cadastrar/comprar | Schema não rodado no Supabase, ou `SUPABASE_SERVICE_KEY` é a *publishable* (use a **secret**). |
| "Aguarde uma atendente assumir" ao gerar Pix | Ninguém clicou em **Assumir atendimento** ainda — uma sócia precisa assumir antes do checkout. |
| "Você ainda não está cadastrada como vendedora" | O `discord_user_id` de quem clicou não está na tabela `sellers` (ou está `active = false`). Veja [Cadastrar as sócias](#cadastrar-as-sócias-vendedoras). |
| Pix não abre / cai na conta errada | Confira a `pix_key`/`merchant_*` da sócia em `sellers` (chave válida, nome ≤25, cidade ≤15, sem acento). |

---

## Segurança

- A **secret key** do Supabase (service_role) tem acesso total ao banco: mantenha só no `.env`
  (já ignorado pelo `.gitignore`), nunca no front nem no git.
- A confirmação é **manual**: o cliente "Já paguei" é só um aviso — **sempre confira o comprovante**
  e o valor no seu app do banco antes de aprovar.
- O bot checa o **cargo da equipe** em Aprovar/Recusar; quem não tem o cargo é ignorado.

---

## Documentação técnica

Detalhes de arquitetura, roteamento de interações, convenção de `customId` e responsabilidades de cada
módulo estão em **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)**.

O sistema de **cupons de desconto** (fluxo do cliente, comandos da equipe, cálculo do desconto e modelo de
dados) está documentado em **[docs/CUPONS.md](docs/CUPONS.md)**.

### Estrutura de arquivos

```
src/
  index.js              # entry do bot (login + eventos)
  config.js             # carrega e valida o .env
  commands.js           # definições + handlers dos comandos slash
  deploy-commands.js    # registra os comandos no servidor
  lib/
    pix.js              # gerador de Pix Copia e Cola (EMV/BR Code) + CRC16
    embeds.js           # embeds: card de produto, carrinho, Pix, venda
    components.js       # botões, select menus e IDs dos componentes
    cartView.js         # monta/atualiza a mensagem do carrinho
    permissions.js      # checagem do cargo da equipe
    supabase.js         # cliente Supabase
  db/
    products.js         # CRUD de produtos
    orders.js           # pedidos, itens, total e desconto do cupom
    sellers.js          # sócias/vendedoras (chave Pix de quem assume)
    coupons.js          # cupons de desconto (CRUD + validação)
  interactions/
    router.js           # roteia botões/selects/modais/comandos
    tickets.js          # abrir/fechar/assumir ticket de atendimento
    catalog.js          # vitrine (browse), comprar, adicionar itens, carrinho
    coupons.js          # aplicar/remover cupom no carrinho
    checkout.js         # gera Pix (QR + Copia e Cola) na chave de quem assumiu
    staff.js            # "já paguei", aprovar, recusar, copiar pix
supabase/schema.sql     # schema do banco
docs/ARQUITETURA.md     # documentação técnica
```
