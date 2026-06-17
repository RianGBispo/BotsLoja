-- ============================================================
--  Loja Discord (RedM/peds)
--  Schema do Supabase. Rode no SQL Editor do projeto.
-- ============================================================

-- Extensão para gerar UUIDs
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- PRODUTOS (peds): cadastrados uma vez, o bot monta o embed sozinho
-- ---------------------------------------------------------------
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique not null,            -- ex.: PED-0042 (aparece no rodapé do card)
  name          text not null,
  description   text,                            -- lore / descrição
  price         numeric(10,2) not null check (price >= 0),
  category      text,
  compatibility text,                            -- ex.: "MP / SP"
  image_url     text,                            -- render do Blender (preview do card)
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Para bancos já existentes que tinham a coluna de referência de arquivo (removida):
alter table products drop column if exists file_path;

-- ---------------------------------------------------------------
-- VENDEDORAS (sócias): quem assume o ticket recebe o Pix.
-- Cada uma tem sua própria chave. Adicionar gente nova = inserir uma linha.
-- ---------------------------------------------------------------
create table if not exists sellers (
  id              uuid primary key default gen_random_uuid(),
  discord_user_id text unique not null,          -- liga a sócia ao usuário do Discord que assume
  name            text not null,
  pix_key         text not null,                 -- chave Pix dela (CPF, e-mail, telefone, aleatória)
  merchant_name   text not null,                 -- nome que aparece no Pix (max. 25)
  merchant_city   text not null,                 -- cidade do recebedor (max. 15)
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Exemplo de cadastro (troque pelos dados reais de cada sócia):
-- insert into sellers (discord_user_id, name, pix_key, merchant_name, merchant_city) values
--   ('111111111111111111', 'Ana', 'ana@email.com',  'ANA SOBRENOME', 'CUIABA'),
--   ('222222222222222222', 'Bia', '06599999999',     'BIA SOBRENOME', 'CUIABA');

-- ---------------------------------------------------------------
-- PEDIDOS: um por ticket. order_number vira o txid (ex.: MN-0042)
-- ---------------------------------------------------------------
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    bigint generated always as identity,
  discord_user_id text not null,                 -- comprador
  channel_id      text not null,                 -- canal do ticket
  cart_message_id text,                          -- mensagem do carrinho (pra re-renderizar)
  status          text not null default 'cart'
                  check (status in ('cart','pending_payment','awaiting_review','paid','delivered','rejected','cancelled')),
  total           numeric(10,2) not null default 0,
  pix_txid        text,                          -- ex.: MN0042
  claimed_by      text,                          -- discord id da sócia que assumiu (recebe o Pix)
  reject_reason   text,
  approved_by     text,                          -- discord id de quem aprovou
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Para bancos já existentes (a coluna não é criada pelo "create table if not exists" acima):
alter table orders add column if not exists claimed_by text;

-- ---------------------------------------------------------------
-- ITENS DO PEDIDO (carrinho): snapshot do preço no momento da compra
-- ---------------------------------------------------------------
create table if not exists order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  unit_price numeric(10,2) not null,
  qty        integer not null default 1 check (qty > 0),
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

-- Atualiza updated_at em orders automaticamente
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- Índices úteis
create index if not exists idx_orders_channel on orders(channel_id);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_order_items_order on order_items(order_id);
