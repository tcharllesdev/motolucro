import React, { forwardRef } from 'react';

export type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

function isFinePointerDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: fine)').matches;
}

/**
 * Campo de data nativo com abertura imediata do calendário ao clicar em qualquer
 * área do campo em dispositivos desktop (ponteiro fino).
 *
 * - No mobile (ponteiro grosso/touch), preserva 100% o comportamento nativo.
 * - No teclado (foco via Tab), não força a abertura do calendário para manter
 *   a digitação direta de DD/MM/AAAA acessível.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className = '', onClick, disabled, readOnly, ...rest },
  ref
) {
  function handleClick(e: React.MouseEvent<HTMLInputElement>) {
    onClick?.(e);
    if (e.defaultPrevented || disabled || readOnly) {
      return;
    }

    if (!isFinePointerDevice()) {
      return;
    }

    const input = e.currentTarget;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        // Fallback silencioso caso o navegador bloqueie ou o picker já esteja aberto
      }
    }
  }

  const mergedClassName = ['cursor-pointer', className].filter(Boolean).join(' ');

  return (
    <input
      ref={ref}
      type="date"
      disabled={disabled}
      readOnly={readOnly}
      onClick={handleClick}
      className={mergedClassName}
      {...rest}
    />
  );
});
