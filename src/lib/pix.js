// ============================================================
//  Gerador de Pix "Copia e Cola" (BR Code / EMV) — sem dependências.
//  Padrão EMV(R)QRCPS do Banco Central. Taxa zero, sem gateway.
// ============================================================

// Monta um campo EMV: ID (2 dígitos) + tamanho (2 dígitos) + valor.
function field(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

// CRC16-CCITT (polinômio 0x1021, init 0xFFFF) — exigido pelo padrão (campo 63).
function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Remove acentos e caracteres fora do conjunto aceito pelos bancos.
function sanitize(text, maxLen) {
  const clean = String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, '')
    .trim();
  return clean.slice(0, maxLen);
}

/**
 * Gera o BR Code (string Copia e Cola).
 * @param {object} p
 * @param {string} p.key   Chave Pix (e-mail, CPF/CNPJ, telefone ou aleatoria)
 * @param {number} p.amount Valor em reais (ex.: 49.90)
 * @param {string} p.merchantName Nome do recebedor (max. 25)
 * @param {string} p.merchantCity Cidade do recebedor (max. 15)
 * @param {string} p.txid  Identificador do pagamento (ex.: MN0042, max. 25, sem espacos)
 */
export function gerarPixCopiaECola({ key, amount, merchantName, merchantCity, txid }) {
  const gui = field('00', 'br.gov.bcb.pix');
  const chave = field('01', key);
  const merchantAccountInfo = field('26', gui + chave);

  const safeTxid = sanitize(txid || '***', 25).replace(/\s/g, '') || '***';
  const additionalData = field('62', field('05', safeTxid));

  const amountStr = Number(amount).toFixed(2);

  let payload =
    field('00', '01') +                                  // Payload Format Indicator
    field('01', '12') +                                  // Point of Initiation: 12 = uso unico
    merchantAccountInfo +                                // Conta Pix
    field('52', '0000') +                                // Merchant Category Code
    field('53', '986') +                                 // Moeda: BRL
    field('54', amountStr) +                             // Valor
    field('58', 'BR') +                                  // Pais
    field('59', sanitize(merchantName, 25)) +            // Nome do recebedor
    field('60', sanitize(merchantCity, 15)) +            // Cidade
    additionalData +                                     // txid
    '6304';                                              // CRC16 (id+len; valor calculado a seguir)

  payload += crc16(payload);
  return payload;
}
