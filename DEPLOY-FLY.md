# Deploy no Fly.io

Guia completo para hospedar o bot de loja no [Fly.io](https://fly.io). O bot é um **worker**:
ele só mantém uma conexão de longa duração (gateway) com o Discord — **não escuta nenhuma porta HTTP**.
Por isso a máquina fica **sempre ligada** (não há tráfego de entrada para "acordá-la").

> O banco de dados continua no **Supabase** (não roda no Fly). O Fly hospeda só o processo do bot.

---

## Índice

- [Como funciona o deploy](#como-funciona-o-deploy)
- [Pré-requisitos](#pré-requisitos)
- [1. Instalar o flyctl e logar](#1-instalar-o-flyctl-e-logar)
- [2. Criar o app](#2-criar-o-app)
- [3. Configurar os secrets (variáveis de ambiente)](#3-configurar-os-secrets-variáveis-de-ambiente)
- [4. Fazer o deploy](#4-fazer-o-deploy)
- [5. Conferir que está no ar](#5-conferir-que-está-no-ar)
- [Atualizar o bot (novo deploy)](#atualizar-o-bot-novo-deploy)
- [Comandos do dia a dia](#comandos-do-dia-a-dia)
- [Custo](#custo)
- [Solução de problemas](#solução-de-problemas)

---

## Como funciona o deploy

Três arquivos na raiz controlam o deploy (já incluídos no repositório):

| Arquivo | Função |
|---|---|
| [`Dockerfile`](Dockerfile) | Imagem Node 20, instala dependências de produção e roda `npm run bot`. |
| [`fly.toml`](fly.toml) | Config do app: região, tamanho da VM, processo worker e `release_command`. |
| [`.dockerignore`](.dockerignore) | Mantém `node_modules`, `.env` e o `.git` **fora** da imagem. |

O `fly.toml` define um `release_command = "npm run deploy-commands"`: a cada deploy, o Fly **registra os
comandos slash** automaticamente antes de subir a nova versão. Você não precisa rodar isso na mão.

---

## Pré-requisitos

- Conta no [Fly.io](https://fly.io/app/sign-up) (pede cartão na criação, mas o uso aqui é mínimo — veja [Custo](#custo)).
- O bot já **funcionando localmente** (token do Discord, projeto Supabase com o `schema.sql` rodado, sócias
  cadastradas). Se ainda não fez isso, siga o [README.md](README.md) primeiro.
- Os mesmos valores do seu `.env` em mãos — eles viram **secrets** no Fly.

---

## 1. Instalar o flyctl e logar

O `flyctl` é a CLI do Fly.

**Windows (PowerShell):**

```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

**macOS / Linux:**

```bash
curl -L https://fly.io/install.sh | sh
```

Depois, faça login (abre o navegador):

```bash
fly auth login
```

---

## 2. Criar o app

Na raiz do projeto (`d:\Projetos\BotsLoja`), crie o app **sem fazer deploy ainda**:

```bash
fly apps create loja-bot
```

> O nome `loja-bot` precisa ser **único no Fly**. Se já existir, escolha outro (ex.: `loja-moonlight-bot`)
> e **atualize o campo `app =`** no [`fly.toml`](fly.toml) para o mesmo nome.

A região já está fixada em `gru` (São Paulo) no `fly.toml`. Para ver outras: `fly platform regions`.

---

## 3. Configurar os secrets (variáveis de ambiente)

No Fly, o `.env` **não vai junto** (está no `.dockerignore`). As variáveis viram *secrets*, criptografadas
e injetadas no ambiente do bot. Defina todas de uma vez (troque pelos seus valores reais):

```bash
fly secrets set \
  DISCORD_TOKEN="seu_token_do_bot" \
  DISCORD_CLIENT_ID="id_da_aplicacao" \
  GUILD_ID="id_do_seu_servidor" \
  STAFF_ROLE_ID="id_do_cargo_equipe" \
  SUPABASE_URL="https://xxxxxxxx.supabase.co" \
  SUPABASE_SERVICE_KEY="service_role_key_do_supabase" \
  PIX_KEY="sua_chave_pix"
```

> No **PowerShell**, troque a continuação de linha `\` por crase (`` ` ``), ou rode tudo em uma linha só.

**Obrigatórias** (o bot não inicia sem elas — validadas em [`src/config.js`](src/config.js)):
`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID`, `STAFF_ROLE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PIX_KEY`.

**Opcionais** (adicione as que você usa, com o mesmo `fly secrets set NOME="valor"`):

```
TICKET_CATEGORY_ID   TICKET_PANEL_CHANNEL_ID   CATALOG_CHANNEL_ID   SALES_CHANNEL_ID
TRANSCRIPT_CHANNEL_ID   WELCOME_CHANNEL_ID   WELCOME_TITLE   WELCOME_IMAGE_URL
PIX_MERCHANT_NAME   PIX_MERCHANT_CITY
BRAND_COLOR   BRAND_NAME   BRAND_BANNER_URL   BRAND_LOGO_URL   BRAND_FOOTER
```

Conferir o que já está definido (mostra só os nomes, nunca os valores):

```bash
fly secrets list
```

> **Intents privilegiados:** o bot usa `Server Members Intent` e `Message Content Intent`. Garanta que
> os dois estão **ligados** no [Developer Portal](https://discord.com/developers/applications) → sua app →
> *Bot*, senão ele não loga. (Isso é config do Discord, não do Fly.)

---

## 4. Fazer o deploy

```bash
fly deploy
```

O que acontece: o Fly faz o build da imagem (Dockerfile), roda o `release_command`
(`npm run deploy-commands` → registra os comandos slash) e sobe **1 máquina** com o bot.

---

## 5. Conferir que está no ar

```bash
fly logs        # logs ao vivo — procure por "✅ Bot online como ..."
fly status      # estado da máquina (deve estar "started")
```

No Discord, os comandos `/painel`, `/vitrine` e `/produto-add` devem aparecer e o bot ficar **online**.

---

## Atualizar o bot (novo deploy)

Sempre que mudar o código:

```bash
fly deploy
```

Mudou só um secret? `fly secrets set ...` já **reinicia** a máquina sozinho, sem precisar de deploy.

---

## Comandos do dia a dia

| Comando | Para quê |
|---|---|
| `fly logs` | Ver os logs ao vivo. |
| `fly status` | Estado da(s) máquina(s). |
| `fly secrets list` | Listar nomes dos secrets. |
| `fly ssh console` | Abrir um shell dentro da máquina. |
| `fly apps restart loja-bot` | Reiniciar o bot. |
| `fly scale count 1` | Garantir **exatamente 1** máquina (nunca rode 2 — duplicaria respostas). |

> ⚠️ **Nunca rode mais de uma instância.** Dois processos logados no mesmo bot respondem cada interação
> em duplicado. Mantenha `count 1`.

---

## Custo

A VM configurada é `shared-cpu-1x` com **256 MB** de RAM, a menor disponível — suficiente para este bot.
Como não há serviço HTTP, a máquina não dorme. O custo de uma máquina desse tamanho ligada o mês todo é
de poucos dólares; confira os valores atuais em [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/).
Para reduzir, dá para baixar a memória no `fly.toml` (`[[vm]] memory`) e reimplantar.

---

## Solução de problemas

| Sintoma | Causa provável / solução |
|---|---|
| `Error: Variável de ambiente obrigatória ausente: X` nos logs | Faltou um secret obrigatório. Rode `fly secrets set X="..."`. |
| Bot não loga / "disallowed intents" | Ligue *Server Members* e *Message Content* no Developer Portal; confira `DISCORD_TOKEN`. |
| Comandos `/` não aparecem | Veja se o `release_command` passou: `fly logs`. Confira `DISCORD_CLIENT_ID` e `GUILD_ID`. |
| App name já em uso ao criar | Escolha outro nome e atualize `app =` no `fly.toml`. |
| Máquina reinicia em loop | `fly logs` mostra o erro real (quase sempre secret faltando ou token inválido). |
| Respostas duplicadas no Discord | Há mais de uma máquina. Rode `fly scale count 1`. |
| Erro de banco ao usar o bot | `schema.sql` não rodado no Supabase, ou `SUPABASE_SERVICE_KEY` é a *publishable* (use a **secret/service_role**). |

---

Pronto. Com a máquina `started` e o "✅ Bot online" nos logs, o bot roda 24/7 no Fly.io.
Detalhes do funcionamento da loja estão no [README.md](README.md).
