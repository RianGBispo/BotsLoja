import { AttachmentBuilder } from 'discord.js';

// Gera uma transcrição HTML de um canal de ticket, com visual parecido com o
// Discord (avatares, nomes coloridos, timestamps, anexos e embeds). Tudo offline,
// sem dependências externas — o HTML abre direto no navegador pra consulta futura.

// Escapa texto pra interpolar com segurança no HTML.
function esc(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Busca TODAS as mensagens do canal (a API entrega no máx. 100 por vez),
// retornando em ordem cronológica (mais antiga primeiro).
export async function fetchAllMessages(channel) {
  const all = [];
  let before;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function fmtDate(date) {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Cor do nome do autor a partir do cargo mais alto (fallback: branco).
function authorColor(message) {
  const color = message.member?.displayHexColor;
  return color && color !== '#000000' ? color : '#ffffff';
}

// Baixa um anexo e devolve um data URI (base64) embutível no HTML — assim a
// imagem fica salva dentro da própria transcrição e continua visível mesmo
// depois que o canal é apagado e a URL do CDN do Discord expira.
// Limita o tamanho pra não gerar HTMLs gigantescos; acima disso, cai no link.
const MAX_INLINE_BYTES = 8 * 1024 * 1024; // 8 MB por imagem

async function toDataURI(att) {
  if (att.size && att.size > MAX_INLINE_BYTES) return null;
  try {
    const res = await fetch(att.url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_INLINE_BYTES) return null;
    const mime = att.contentType || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function renderAttachments(message) {
  if (message.attachments.size === 0) return '';
  const items = await Promise.all(
    [...message.attachments.values()].map(async (att) => {
      const isImage = (att.contentType || '').startsWith('image/');
      if (isImage) {
        const data = await toDataURI(att);
        // Se conseguiu embutir, usa o data URI; senão, mantém o link original.
        const src = data || att.url;
        return `<a href="${esc(att.url)}" target="_blank"><img class="att-img" src="${esc(src)}" alt="${esc(att.name)}"></a>`;
      }
      return `<a class="att-file" href="${esc(att.url)}" target="_blank">📎 ${esc(att.name)}</a>`;
    }),
  );
  return `<div class="attachments">${items.join('')}</div>`;
}

function renderEmbeds(message) {
  if (message.embeds.length === 0) return '';
  return message.embeds
    .map((e) => {
      const bar = e.hexColor || '#4f545c';
      const title = e.title ? `<div class="embed-title">${esc(e.title)}</div>` : '';
      const desc = e.description
        ? `<div class="embed-desc">${esc(e.description).replaceAll('\n', '<br>')}</div>`
        : '';
      const fields = e.fields
        .map(
          (f) =>
            `<div class="embed-field"><div class="embed-field-name">${esc(f.name)}</div><div class="embed-field-value">${esc(f.value).replaceAll('\n', '<br>')}</div></div>`,
        )
        .join('');
      return `<div class="embed" style="border-left-color:${esc(bar)}">${title}${desc}${fields}</div>`;
    })
    .join('');
}

async function renderMessage(message) {
  const avatar = message.author.displayAvatarURL({ extension: 'png', size: 64 });
  const name = message.member?.displayName || message.author.username;
  const content = message.content
    ? `<div class="content">${esc(message.content).replaceAll('\n', '<br>')}</div>`
    : '';

  return `
    <div class="msg">
      <img class="avatar" src="${esc(avatar)}" alt="">
      <div class="body">
        <div class="meta">
          <span class="author" style="color:${authorColor(message)}">${esc(name)}</span>
          <span class="timestamp">${fmtDate(message.createdAt)}</span>
        </div>
        ${content}
        ${renderEmbeds(message)}
        ${await renderAttachments(message)}
      </div>
    </div>`;
}

// Monta o HTML completo da transcrição.
export async function buildTranscriptHTML(channel, messages) {
  const rows = (await Promise.all(messages.map(renderMessage))).join('\n');
  const generatedAt = fmtDate(new Date());

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transcrição — ${esc(channel.name)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #313338; color: #dbdee1;
         font-family: "gg sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .header { padding: 20px 24px; background: #2b2d31; border-bottom: 1px solid #1f2023; }
  .header h1 { margin: 0 0 4px; font-size: 18px; color: #f2f3f5; }
  .header .sub { font-size: 13px; color: #b5bac1; }
  .log { padding: 16px 24px; }
  .msg { display: flex; gap: 16px; padding: 8px 0; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
  .body { min-width: 0; flex: 1; }
  .meta { display: flex; align-items: baseline; gap: 8px; }
  .author { font-weight: 600; font-size: 15px; }
  .timestamp { font-size: 12px; color: #949ba4; }
  .content { font-size: 15px; line-height: 1.375; white-space: pre-wrap; word-wrap: break-word; }
  .attachments { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 8px; }
  .att-img { max-width: 360px; max-height: 280px; border-radius: 8px; display: block; }
  .att-file { color: #00a8fc; text-decoration: none; background: #2b2d31;
              padding: 8px 12px; border-radius: 6px; display: inline-block; }
  .embed { margin-top: 6px; background: #2b2d31; border-left: 4px solid #4f545c;
           border-radius: 4px; padding: 10px 14px; max-width: 520px; }
  .embed-title { font-weight: 600; color: #f2f3f5; margin-bottom: 4px; }
  .embed-desc { font-size: 14px; color: #dbdee1; }
  .embed-field { margin-top: 6px; }
  .embed-field-name { font-weight: 600; font-size: 13px; color: #f2f3f5; }
  .embed-field-value { font-size: 14px; color: #dbdee1; }
  a { color: #00a8fc; }
</style>
</head>
<body>
  <div class="header">
    <h1>🎫 ${esc(channel.name)}</h1>
    <div class="sub">${messages.length} mensage${messages.length === 1 ? 'm' : 'ns'} • Gerado em ${generatedAt}</div>
  </div>
  <div class="log">
    ${rows || '<div class="sub">Nenhuma mensagem.</div>'}
  </div>
</body>
</html>`;
}

// Gera a transcrição do canal e devolve um anexo .html pronto pra enviar.
export async function createTranscriptAttachment(channel) {
  const messages = await fetchAllMessages(channel);
  const html = await buildTranscriptHTML(channel, messages);
  const buffer = Buffer.from(html, 'utf8');
  const file = new AttachmentBuilder(buffer, { name: `transcricao-${channel.name}.html` });
  return { file, count: messages.length };
}
