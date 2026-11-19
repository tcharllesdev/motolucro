import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { formatBRL } from '../calculations';
import { evaluateEarningsExpression, formatEarningsInputValue } from '../earningsExpression';

export interface EarningsInputProps {
  id: string;
  value: string;
  onChange: (nextValue: string) => void;
  variant?: 'default' | 'compact';
  required?: boolean;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  resetKey?: string;
}

interface LastCalculationNote {
  formula: string;
  total: number;
  resolvedValue: string;
}

export function EarningsInput({
  id,
  value,
  onChange,
  variant = 'default',
  required = false,
  placeholder,
  name,
  disabled = false,
  resetKey,
}: EarningsInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastCalculation, setLastCalculation] = useState<LastCalculationNote | null>(null);

  const evaluation = useMemo(() => evaluateEarningsExpression(value), [value]);
  const feedbackId = `${id}-feedback`;
  const isCompact = variant === 'compact';

  // Limpa nota de cálculo anterior quando o valor muda externamente (reset, troca de item etc.)
  useEffect(() => {
    if (lastCalculation && value !== lastCalculation.resolvedValue) {
      setLastCalculation(null);
    }
  }, [value, lastCalculation]);

  useEffect(() => {
    setLastCalculation(null);
  }, [resetKey]);

  function resolveFormulaIfValid(): boolean {
    if (!evaluation.isFormula || evaluation.status !== 'valid' || evaluation.value === null) {
      return false;
    }

    const formatted = formatEarningsInputValue(evaluation.value);
    const formulaLabel = evaluation.normalizedFormula || value.replace(/^=/, '').trim();

    setLastCalculation({
      formula: formulaLabel,
      total: evaluation.value,
      resolvedValue: formatted,
    });
    onChange(formatted);
    return true;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && evaluation.isFormula && evaluation.status === 'valid' && evaluation.value !== null) {
      e.preventDefault();
      resolveFormulaIfValid();
    }
  }

  function handleBlur() {
    resolveFormulaIfValid();
  }

  function handleInsertPlus() {
    if (disabled) return;
    const inputEl = inputRef.current;
    if (inputEl && document.activeElement !== inputEl) {
      inputEl.focus();
    }

    const trimmedEnd = value.trimEnd();

    // Não duplica operador nem insere '+' logo após '=', '+', '-', ',' ou '.'
    if (/[+\-=.,]$/.test(trimmedEnd)) {
      return;
    }

    setLastCalculation(null);
    const nextValue = trimmedEnd === '' ? '+' : `${trimmedEnd}+`;
    onChange(nextValue);

    requestAnimationFrame(() => {
      if (inputRef.current) {
        const len = nextValue.length;
        inputRef.current.setSelectionRange(len, len);
      }
    });
  }

  const borderClasses =
    evaluation.status === 'invalid'
      ? 'border-red-500 focus:border-red-400'
      : evaluation.status === 'incomplete'
        ? 'border-amber-400/70 focus:border-amber-400'
        : evaluation.isFormula && evaluation.status === 'valid'
          ? 'border-emerald-400/80 focus:border-emerald-400'
          : 'border-emerald-500/40 focus:border-emerald-400';

  const hasFeedback =
    evaluation.status === 'invalid' ||
    evaluation.status === 'incomplete' ||
    (evaluation.isFormula && evaluation.status === 'valid' && evaluation.value !== null) ||
    lastCalculation !== null ||
    (evaluation.status === 'empty' && !isCompact);

  const defaultPlaceholder = isCompact ? '210,50 ou =120+85' : 'Ex: 210,50 ou =120+85,50';

  return (
    <div>
      <div className="relative">
        {!isCompact && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold"
          >
            R$
          </span>
        )}

        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          required={required}
          disabled={disabled}
          placeholder={placeholder ?? defaultPlaceholder}
          value={value}
          aria-invalid={evaluation.status === 'invalid'}
          aria-describedby={hasFeedback ? feedbackId : undefined}
          onChange={(e) => {
            setLastCalculation(null);
            onChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={
            isCompact
              ? `w-full bg-slate-900 border ${borderClasses} rounded-lg pl-2.5 pr-8 py-2 text-xs font-bold text-white outline-none transition`
              : `w-full bg-slate-950 border ${borderClasses} rounded-xl pl-10 pr-12 py-3 text-lg font-bold text-white outline-none transition`
          }
        />

        <button
          type="button"
          disabled={disabled}
          aria-label="Adicionar parcela para somar"
          title="Adicionar parcela para somar (+)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleInsertPlus}
          className={
            isCompact
              ? 'absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 active:bg-emerald-500/35 transition disabled:opacity-40'
              : 'absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/35 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 active:bg-emerald-500/35 transition disabled:opacity-40'
          }
        >
          <Plus className={isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden="true" />
        </button>
      </div>

      {hasFeedback && (
        <div
          id={feedbackId}
          aria-live="polite"
          className={isCompact ? 'mt-1 text-[11px] leading-tight' : 'mt-1.5 text-xs leading-snug'}
        >
          {evaluation.status === 'invalid' && (
            <p className="text-red-400 font-medium">{evaluation.error}</p>
          )}

          {evaluation.status === 'incomplete' && (
            <p className="text-amber-300">
              {evaluation.previewValue > 0
                ? isCompact
                  ? `Parcial: ${formatBRL(evaluation.previewValue)}…`
                  : `Soma parcial: ${formatBRL(evaluation.previewValue)} — digite o próximo valor`
                : isCompact
                  ? 'Continue a soma…'
                  : evaluation.error || 'Digite os valores para somar (ex.: =120+85,50)'}
            </p>
          )}

          {evaluation.isFormula && evaluation.status === 'valid' && evaluation.value !== null && (
            <p className="text-emerald-400 font-semibold">
              = {formatBRL(evaluation.value)}
              {!isCompact && (
                <span className="font-normal text-slate-400 ml-1.5">(Enter ou sair aplica)</span>
              )}
            </p>
          )}

          {!evaluation.isFormula &&
            evaluation.status === 'valid' &&
            lastCalculation !== null && (
              <p className="text-slate-400">
                Calculado: {lastCalculation.formula} ={' '}
                <span className="text-emerald-400 font-medium">
                  {formatBRL(lastCalculation.total)}
                </span>
              </p>
            )}

          {evaluation.status === 'empty' && !isCompact && (
            <p className="text-slate-400">
              Aceita soma estilo Excel (ex.: =120+85,50 ou 150+45)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
