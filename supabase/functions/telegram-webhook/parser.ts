export type EarningsExpressionStatus = 'empty' | 'valid' | 'incomplete' | 'invalid';

export interface EarningsExpressionResult {
  status: EarningsExpressionStatus;
  value: number | null;
  previewValue: number;
  isFormula: boolean;
  normalizedFormula: string | null;
  error: string | null;
}

const MAX_EARNINGS_VALUE = 99999999.99;
const ALLOWED_CHARS_REGEX = /^[0-9.,+\-=\s]+$/;

interface ParsedTerm {
  sign: 1 | -1;
  value: number;
  explicitSign: boolean;
}

type NumberTokenResult =
  | { kind: 'valid'; value: number }
  | { kind: 'incomplete'; partialValue: number }
  | { kind: 'invalid' };

function roundCurrency(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatEarningsInputValue(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = roundCurrency(value);
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2).replace('.', ',');
}

function parseNumberToken(token: string, allowTrailingSeparator: boolean): NumberTokenResult {
  if (!token) return { kind: 'invalid' };

  if (/^[.,]/.test(token) || /[.,]{2,}/.test(token)) {
    return { kind: 'invalid' };
  }

  if (allowTrailingSeparator && /[.,]$/.test(token)) {
    const withoutTrailing = token.slice(0, -1);
    if (/^\d+$/.test(withoutTrailing)) {
      const parsed = Number(withoutTrailing);
      if (Number.isFinite(parsed)) return { kind: 'incomplete', partialValue: parsed };
    }
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(withoutTrailing)) {
      const parsed = Number(withoutTrailing.replace(/\./g, ''));
      if (Number.isFinite(parsed)) return { kind: 'incomplete', partialValue: parsed };
    }
    return { kind: 'invalid' };
  }

  if (/[.,]$/.test(token)) {
    return { kind: 'invalid' };
  }

  const hasComma = token.includes(',');
  const hasDot = token.includes('.');

  if (hasComma && hasDot) {
    if (!/^[1-9]\d{0,2}(\.\d{3})+,\d+$/.test(token)) {
      return { kind: 'invalid' };
    }
    const normalized = token.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
  }

  if (hasComma) {
    if (!/^\d+,\d+$/.test(token)) {
      return { kind: 'invalid' };
    }
    const parsed = Number(token.replace(',', '.'));
    return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
  }

  if (hasDot) {
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(token)) {
      const parsed = Number(token.replace(/\./g, ''));
      return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
    }
    if (/^\d+\.\d+$/.test(token)) {
      const parsed = Number(token);
      return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
    }
    return { kind: 'invalid' };
  }

  if (!/^\d+$/.test(token)) {
    return { kind: 'invalid' };
  }

  const parsed = Number(token);
  return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
}

function buildNormalizedFormula(terms: ParsedTerm[]): string {
  return terms
    .map((term, index) => {
      const formatted = formatEarningsInputValue(term.value);
      if (index === 0) {
        if (term.sign === -1) return `-${formatted}`;
        return formatted;
      }
      return `${term.sign === 1 ? '+' : '-'} ${formatted}`;
    })
    .join(' ');
}

export function evaluateEarningsExpression(raw: string): EarningsExpressionResult {
  const sanitized = raw.replace(/r\$/gi, ' ').trim();

  if (sanitized === '') {
    return {
      status: 'empty',
      value: null,
      previewValue: 0,
      isFormula: false,
      normalizedFormula: null,
      error: null,
    };
  }

  const hasLeadingEquals = sanitized.startsWith('=');

  if (!ALLOWED_CHARS_REGEX.test(sanitized)) {
    return {
      status: 'invalid',
      value: null,
      previewValue: 0,
      isFormula: hasLeadingEquals || /[+-]/.test(sanitized),
      normalizedFormula: null,
      error: 'Use apenas números, vírgula/ponto e sinais + ou - (ex.: =120+85,50).',
    };
  }

  const body = hasLeadingEquals ? sanitized.slice(1).trim() : sanitized;

  if (body.includes('=')) {
    return {
      status: 'invalid',
      value: null,
      previewValue: 0,
      isFormula: true,
      normalizedFormula: null,
      error: 'Use o sinal "=" apenas no início da soma.',
    };
  }

  if (body === '') {
    return {
      status: 'incomplete',
      value: null,
      previewValue: 0,
      isFormula: true,
      normalizedFormula: null,
      error: 'Digite os valores após "=" para somar.',
    };
  }

  const tokens: Array<{ type: 'op'; value: '+' | '-' } | { type: 'num'; value: string }> = [];
  let i = 0;

  while (i < body.length) {
    const ch = body[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-') {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    const start = i;
    while (i < body.length && /[0-9.,]/.test(body[i])) {
      i += 1;
    }
    tokens.push({ type: 'num', value: body.slice(start, i) });
  }

  const hasOperator = tokens.some((t) => t.type === 'op');
  const isFormula = hasLeadingEquals || hasOperator;

  const terms: ParsedTerm[] = [];
  let pendingSign: (1 | -1) | null = null;
  let expectingNumber = false;
  let hasTrailingIncompleteDecimal = false;
  let trailingPartialValue = 0;

  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx];
    const isLastToken = idx === tokens.length - 1;

    if (token.type === 'op') {
      if (pendingSign !== null) {
        return {
          status: 'invalid',
          value: null,
          previewValue: 0,
          isFormula: true,
          normalizedFormula: null,
          error: 'Operadores duplicados na expressão. Use apenas um + ou - entre valores.',
        };
      }
      pendingSign = token.value === '+' ? 1 : -1;
      expectingNumber = true;
      continue;
    }

    if (terms.length > 0 && pendingSign === null) {
      return {
        status: 'invalid',
        value: null,
        previewValue: 0,
        isFormula,
        normalizedFormula: null,
        error: 'Separe os valores usando os sinais + ou -.',
      };
    }

    const parsedNum = parseNumberToken(token.value, isLastToken);
    if (parsedNum.kind === 'invalid') {
      return {
        status: 'invalid',
        value: null,
        previewValue: 0,
        isFormula,
        normalizedFormula: null,
        error: 'Formato de número inválido. Exemplo válido: 120+85,50.',
      };
    }

    const sign: 1 | -1 = pendingSign ?? 1;
    const explicitSign = pendingSign !== null;
    pendingSign = null;
    expectingNumber = false;

    if (parsedNum.kind === 'incomplete') {
      hasTrailingIncompleteDecimal = true;
      trailingPartialValue = sign * parsedNum.partialValue;
      break;
    }

    terms.push({
      sign,
      value: parsedNum.value,
      explicitSign,
    });
  }

  const rawSum = terms.reduce((acc, term) => acc + term.sign * term.value, 0);

  if (expectingNumber) {
    const partialRounded = roundCurrency(rawSum);
    const safePreview =
      Number.isFinite(partialRounded) && partialRounded >= 0 && partialRounded <= MAX_EARNINGS_VALUE
        ? partialRounded
        : 0;
    return {
      status: 'incomplete',
      value: null,
      previewValue: safePreview,
      isFormula: true,
      normalizedFormula: null,
      error:
        terms.length === 0
          ? 'Digite um valor após o sinal para calcular.'
          : 'Complete a soma digitando o próximo valor.',
    };
  }

  if (hasTrailingIncompleteDecimal) {
    const partialRounded = roundCurrency(rawSum + trailingPartialValue);
    const safePreview =
      Number.isFinite(partialRounded) && partialRounded >= 0 && partialRounded <= MAX_EARNINGS_VALUE
        ? partialRounded
        : 0;
    return {
      status: 'incomplete',
      value: null,
      previewValue: safePreview,
      isFormula,
      normalizedFormula: null,
      error: 'Complete os centavos após a vírgula.',
    };
  }

  const roundedTotal = roundCurrency(rawSum);

  if (!Number.isFinite(roundedTotal) || roundedTotal > MAX_EARNINGS_VALUE) {
    return {
      status: 'invalid',
      value: null,
      previewValue: 0,
      isFormula,
      normalizedFormula: null,
      error: 'O valor total ultrapassa o limite permitido (R$ 99.999.999,99).',
    };
  }

  if (roundedTotal < 0) {
    return {
      status: 'invalid',
      value: null,
      previewValue: 0,
      isFormula,
      normalizedFormula: null,
      error: 'O resultado da soma não pode ser negativo.',
    };
  }

  const finalIsFormula =
    hasLeadingEquals || terms.length > 1 || (terms.length === 1 && terms[0].explicitSign);

  return {
    status: 'valid',
    value: roundedTotal,
    previewValue: roundedTotal,
    isFormula: finalIsFormula,
    normalizedFormula: finalIsFormula ? buildNormalizedFormula(terms) : null,
    error: null,
  };
}

export type TelegramCommand =
  | { type: 'start'; code: string | null }
  | { type: 'vincular'; code: string | null }
  | { type: 'ajuda' }
  | { type: 'ultimo' }
  | { type: 'resumo' }
  | { type: 'desvincular' };

export function parseTelegramCommand(text: string): TelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const firstSpace = trimmed.search(/\s/);
  const rawCmd = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  const cmdName = rawCmd.split('@')[0];
  const arg = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  switch (cmdName) {
    case '/start':
      return { type: 'start', code: arg ? arg.split(/\s+/)[0].toUpperCase() : null };
    case '/vincular':
      return { type: 'vincular', code: arg ? arg.split(/\s+/)[0].toUpperCase() : null };
    case '/ajuda':
    case '/help':
      return { type: 'ajuda' };
    case '/ultimo':
    case '/último':
      return { type: 'ultimo' };
    case '/resumo':
      return { type: 'resumo' };
    case '/desvincular':
      return { type: 'desvincular' };
    default:
      return null;
  }
}

export function getSaoPauloTodayStr(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function parseDateToken(raw: string, todayStr: string): string | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized === 'hoje') return todayStr;
  if (normalized === 'ontem') return addDaysToDateStr(todayStr, -1);
  if (normalized === 'anteontem') return addDaysToDateStr(todayStr, -2);

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const brFullMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (brFullMatch) {
    const day = Number(brFullMatch[1]);
    const month = Number(brFullMatch[2]);
    let year = Number(brFullMatch[3]);
    if (brFullMatch[3].length === 2) {
      year += 2000;
    }
    if (!isValidCalendarDate(year, month, day)) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const brShortMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (brShortMatch) {
    const day = Number(brShortMatch[1]);
    const month = Number(brShortMatch[2]);
    const [curYear, curMonth] = todayStr.split('-').map(Number);
    const inferredYear = month > curMonth + 1 ? curYear - 1 : curYear;
    if (!isValidCalendarDate(inferredYear, month, day)) return null;
    return `${String(inferredYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

export function parseTimeToken(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function parseKmToken(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s*km$/i, '').replace(/r\$/gi, '');
  if (!/^\d+(?:[.,]\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999999.99) return null;
  return Math.round(parsed * 100) / 100;
}

export interface ParsedDailyLogInput {
  logDate: string;
  kmStart: number;
  kmEnd: number;
  kmTotal: number;
  earnings: number;
  isFormula: boolean;
  normalizedFormula: string | null;
  startTime: string | null;
  endTime: string | null;
}

export type ParseDailyLogResult =
  | { ok: true; data: ParsedDailyLogInput }
  | { ok: false; error: string };

function normalizeLabelKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseLabeledMessage(body: string, todayStr: string): ParseDailyLogResult | null {
  const accentedLabelPattern =
    /(?:^|[\n,;|]|\s)(km\s+inicial|km\s+in[íi]cio|km\s+final|km\s+fim|kmi|kmf|od[ôo]metro\s+inicial|od[ôo]metro\s+final|valor\s+obtido|valor|ganhos?|faturamento|bruto|recebi|total|data|dia|hora\s+inicial|hora\s+in[íi]cio|hora\s+final|hora\s+fim|in[íi]cio|inicio|fim|entrada|sa[íi]da)(?::\s*|\s+|=(?=\d))/gi;

  const matches: Array<{ key: string; valueStart: number; matchStart: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = accentedLabelPattern.exec(body)) !== null) {
    const key = normalizeLabelKey(m[1]);
    const fullMatch = m[0];
    const hasLeadingDelim =
      fullMatch.startsWith(' ') ||
      fullMatch.startsWith('\n') ||
      fullMatch.startsWith(',') ||
      fullMatch.startsWith(';') ||
      fullMatch.startsWith('|');
    matches.push({
      key,
      matchStart: m.index + (hasLeadingDelim ? 1 : 0),
      valueStart: m.index + fullMatch.length,
    });
  }

  if (matches.length === 0) return null;

  const fields: Record<string, string> = {};
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].matchStart : body.length;
    const rawValue = body
      .slice(cur.valueStart, nextStart)
      .replace(/^[\s:]+|[\s,;|]+$/g, '')
      .trim();
    if (!rawValue) continue;

    if (cur.key === 'km inicial' || cur.key === 'km inicio' || cur.key === 'kmi' || cur.key === 'odometro inicial') {
      fields.kmStart = rawValue;
    } else if (cur.key === 'km final' || cur.key === 'km fim' || cur.key === 'kmf' || cur.key === 'odometro final') {
      fields.kmEnd = rawValue;
    } else if (
      cur.key === 'valor obtido' ||
      cur.key === 'valor' ||
      cur.key === 'ganho' ||
      cur.key === 'ganhos' ||
      cur.key === 'faturamento' ||
      cur.key === 'bruto' ||
      cur.key === 'recebi' ||
      cur.key === 'total'
    ) {
      fields.earnings = rawValue;
    } else if (cur.key === 'data' || cur.key === 'dia') {
      fields.date = rawValue;
    } else if (cur.key === 'inicio' || cur.key === 'hora inicial' || cur.key === 'hora inicio' || cur.key === 'entrada') {
      fields.startTime = rawValue;
    } else if (cur.key === 'fim' || cur.key === 'hora final' || cur.key === 'hora fim' || cur.key === 'saida') {
      fields.endTime = rawValue;
    }
  }

  const recognizedCount = Object.keys(fields).length;
  if (recognizedCount < 2) return null;

  let logDate = todayStr;
  if (fields.date) {
    const parsedDate = parseDateToken(fields.date, todayStr);
    if (!parsedDate) {
      return {
        ok: false,
        error: `Data inválida ("${fields.date}"). Use hoje, ontem, DD/MM ou DD/MM/AAAA.`,
      };
    }
    logDate = parsedDate;
  }

  if (!fields.kmStart || !fields.kmEnd || !fields.earnings) {
    return {
      ok: false,
      error:
        'Faltou informar algum campo obrigatório (KM inicial, KM final e valor).\nExemplo: 10490 10620 250 ou km inicial 10490 km final 10620 valor 250.',
    };
  }

  const kmStart = parseKmToken(fields.kmStart);
  const kmEnd = parseKmToken(fields.kmEnd);
  if (kmStart === null || kmEnd === null) {
    return {
      ok: false,
      error: 'KM inicial ou KM final inválido. Informe apenas números (ex.: 10490 ou 10490,5).',
    };
  }
  if (kmEnd <= kmStart) {
    return { ok: false, error: 'O KM Final deve ser maior que o KM Inicial.' };
  }

  const parsedEarnings = evaluateEarningsExpression(fields.earnings);
  if (parsedEarnings.status !== 'valid' || parsedEarnings.value === null) {
    return {
      ok: false,
      error: parsedEarnings.error || 'Informe um valor obtido válido (ex.: 250,50 ou =120+85,50).',
    };
  }

  let startTime: string | null = null;
  let endTime: string | null = null;
  if (fields.startTime || fields.endTime) {
    if (!fields.startTime || !fields.endTime) {
      return {
        ok: false,
        error: 'Se informar horário, envie início e fim (ex.: início 09:40 fim 18:20).',
      };
    }
    startTime = parseTimeToken(fields.startTime);
    endTime = parseTimeToken(fields.endTime);
    if (!startTime || !endTime) {
      return {
        ok: false,
        error: 'Horário inválido. Use o formato HH:MM (ex.: 09:40 e 18:20).',
      };
    }
  }

  return {
    ok: true,
    data: {
      logDate,
      kmStart,
      kmEnd,
      kmTotal: Number((kmEnd - kmStart).toFixed(1)),
      earnings: parsedEarnings.value,
      isFormula: parsedEarnings.isFormula,
      normalizedFormula: parsedEarnings.normalizedFormula,
      startTime,
      endTime,
    },
  };
}

function tokenizePositionalInput(body: string): string[] {
  let normalized = body
    .replace(/r\$\s*/gi, '')
    .replace(/[\n;|]+/g, ' ')
    .replace(/,\s+/g, ' ')
    .trim();

  // Remove espaços após '=' e ao redor de '+' / '-' em expressões numéricas sem colar o '=' no token anterior
  normalized = normalized
    .replace(/=\s+/g, '=')
    .replace(/([0-9=])\s*\+\s*(?=\d)/g, '$1+')
    .replace(/([0-9=])\s*-\s*(?=\d)/g, '$1-');

  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (const tok of rawTokens) {
    const lower = tok.toLowerCase();
    if (lower === 'km' || lower === 'a' || lower === 'ate' || lower === 'até' || lower === '-') {
      continue;
    }
    tokens.push(tok.replace(/km$/i, ''));
  }

  return tokens.filter(Boolean);
}

export function parseDailyLogMessage(rawText: string, now: Date = new Date()): ParseDailyLogResult {
  const todayStr = getSaoPauloTodayStr(now);
  let body = rawText.trim();

  if (!body) {
    return {
      ok: false,
      error: 'Envie KM inicial, KM final e valor.\nExemplo: 10490 10620 250',
    };
  }

  body = body.replace(/^\/(lancar|lançar|registrar)(?:@[a-z0-9_]+)?\s+/i, '').trim();

  const labeledAttempt = parseLabeledMessage(body, todayStr);
  if (labeledAttempt !== null) {
    return labeledAttempt;
  }

  const tokens = tokenizePositionalInput(body);
  if (tokens.length < 3) {
    return {
      ok: false,
      error:
        'Não consegui identificar os 3 campos obrigatórios (KM inicial, KM final e valor).\nExemplos:\n• 10490 10620 250\n• 10490 10620 =120+85,50\n• ontem 10490 10620 250 09:40 18:20',
    };
  }

  let logDate = todayStr;
  let explicitDateCount = 0;
  const times: string[] = [];
  const valueTokens: string[] = [];

  for (const tok of tokens) {
    const maybeDate = parseDateToken(tok, todayStr);
    if (maybeDate !== null) {
      if (explicitDateCount > 0) {
        return {
          ok: false,
          error: 'Informe apenas uma data por lançamento.',
        };
      }
      logDate = maybeDate;
      explicitDateCount += 1;
      continue;
    }

    const maybeTime = parseTimeToken(tok);
    if (maybeTime !== null) {
      times.push(maybeTime);
      continue;
    }

    valueTokens.push(tok);
  }

  if (times.length !== 0 && times.length !== 2) {
    return {
      ok: false,
      error: 'Se informar horário, envie início e fim (ex.: 09:40 18:20).',
    };
  }

  if (valueTokens.length !== 3) {
    return {
      ok: false,
      error:
        'Envie exatamente KM inicial, KM final e valor (além de data e horários opcionais).\nExemplos:\n• 10490 10620 250\n• 10490 10620 =120+85,50\n• 18/11 10490 10620 250 09:40 18:20',
    };
  }

  const kmStart = parseKmToken(valueTokens[0]);
  const kmEnd = parseKmToken(valueTokens[1]);

  if (kmStart === null || kmEnd === null) {
    return {
      ok: false,
      error: 'KM inicial e KM final devem ser números válidos (ex.: 10490 10620 250).',
    };
  }

  if (kmEnd <= kmStart) {
    return { ok: false, error: 'O KM Final deve ser maior que o KM Inicial.' };
  }

  const parsedEarnings = evaluateEarningsExpression(valueTokens[2]);
  if (parsedEarnings.status !== 'valid' || parsedEarnings.value === null) {
    return {
      ok: false,
      error: parsedEarnings.error || 'Valor obtido inválido. Exemplos: 250, 250,50 ou =120+85,50.',
    };
  }

  return {
    ok: true,
    data: {
      logDate,
      kmStart,
      kmEnd,
      kmTotal: Number((kmEnd - kmStart).toFixed(1)),
      earnings: parsedEarnings.value,
      isFormula: parsedEarnings.isFormula,
      normalizedFormula: parsedEarnings.normalizedFormula,
      startTime: times.length === 2 ? times[0] : null,
      endTime: times.length === 2 ? times[1] : null,
    },
  };
}

export interface BikeSettingsRow {
  fuel_consumption_km_l: number;
  fuel_price_per_liter: number;
}

export interface MaintenanceItemRow {
  cost: number;
  duration_km: number;
}

export interface DaySummaryMetrics {
  kmTotal: number;
  grossEarnings: number;
  fuelCost: number;
  maintenanceCost: number;
  unexpectedCost: number;
  totalCost: number;
  netProfit: number;
  grossPerKm: number;
  netPerKm: number;
}

export function computeDaySummaryMetrics(
  kmTotal: number,
  earnings: number,
  settings: BikeSettingsRow,
  maintenanceItems: MaintenanceItemRow[],
  unexpectedCost: number
): DaySummaryMetrics {
  const fuelPerKm =
    settings.fuel_consumption_km_l > 0
      ? settings.fuel_price_per_liter / settings.fuel_consumption_km_l
      : 0;
  const maintPerKm = maintenanceItems.reduce((acc, item) => {
    if (!item.duration_km || item.duration_km <= 0) return acc;
    return acc + item.cost / item.duration_km;
  }, 0);

  const fuelCost = kmTotal * fuelPerKm;
  const maintenanceCost = kmTotal * maintPerKm;
  const totalCost = fuelCost + maintenanceCost + unexpectedCost;
  const netProfit = earnings - totalCost;

  return {
    kmTotal,
    grossEarnings: earnings,
    fuelCost,
    maintenanceCost,
    unexpectedCost,
    totalCost,
    netProfit,
    grossPerKm: kmTotal > 0 ? earnings / kmTotal : 0,
    netPerKm: kmTotal > 0 ? netProfit / kmTotal : 0,
  };
}

const WEEKDAYS = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const;

export function formatDateWithWeekdayBR(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = WEEKDAYS[dt.getUTCDay()] ?? '';
  return weekday ? `${parts[2]}/${parts[1]}/${parts[0]} (${weekday})` : `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
