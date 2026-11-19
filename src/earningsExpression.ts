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

  // Rejeita múltiplos separadores consecutivos ou token iniciando em separador sem dígito
  if (/^[.,]/.test(token) || /[.,]{2,}/.test(token)) {
    return { kind: 'invalid' };
  }

  // Trailing ',' ou '.' no último termo enquanto o usuário ainda digita os centavos
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
    // Formato pt-BR com milhar '.' e decimal ',' (ex: 1.250,50 ou 1.250.000,50)
    if (!/^[1-9]\d{0,2}(\.\d{3})+,\d+$/.test(token)) {
      return { kind: 'invalid' };
    }
    const normalized = token.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
  }

  if (hasComma) {
    // Formato pt-BR decimal com vírgula (ex: 210,50 | 0,1)
    if (!/^\d+,\d+$/.test(token)) {
      return { kind: 'invalid' };
    }
    const parsed = Number(token.replace(',', '.'));
    return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
  }

  if (hasDot) {
    // Formato pt-BR milhar puro com ponto (ex: 1.250 ou 1.250.000)
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(token)) {
      const parsed = Number(token.replace(/\./g, ''));
      return Number.isFinite(parsed) ? { kind: 'valid', value: parsed } : { kind: 'invalid' };
    }
    // Formato decimal com ponto (ex: 210.50 | 210.5 | 0.25)
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
  const trimmed = raw.trim();

  if (trimmed === '') {
    return {
      status: 'empty',
      value: null,
      previewValue: 0,
      isFormula: false,
      normalizedFormula: null,
      error: null,
    };
  }

  const hasLeadingEquals = trimmed.startsWith('=');

  if (!ALLOWED_CHARS_REGEX.test(trimmed)) {
    return {
      status: 'invalid',
      value: null,
      previewValue: 0,
      isFormula: hasLeadingEquals || /[+-]/.test(trimmed),
      normalizedFormula: null,
      error: 'Use apenas números, vírgula/ponto e sinais + ou - (ex.: =120+85,50).',
    };
  }

  const body = hasLeadingEquals ? trimmed.slice(1).trim() : trimmed;

  // Qualquer '=' restante significa múltiplos '=' ou '=' fora do início
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

  // Tokenização manual em operadores ('+' | '-') e números ([0-9.,]+)
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
      // Operador consecutivo (ex: ++, +-, -+, --)
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

    // Dois números seguidos sem operador (ex: "100 50")
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

  // Expressão terminou com '+' ou '-' (ex: "120+", "+", "120+85,50-")
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

  // Expressão terminou no meio dos centavos (ex: "210," ou "120+85,")
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

  const finalIsFormula = hasLeadingEquals || terms.length > 1 || (terms.length === 1 && terms[0].explicitSign);

  return {
    status: 'valid',
    value: roundedTotal,
    previewValue: roundedTotal,
    isFormula: finalIsFormula,
    normalizedFormula: finalIsFormula ? buildNormalizedFormula(terms) : null,
    error: null,
  };
}
