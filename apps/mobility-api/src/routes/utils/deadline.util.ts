/**
 * Deadline cooperativo: orçamento global de tempo para `checkRoute`.
 *
 * Uso:
 *   const dl = makeDeadline(13_000);
 *   await dl.race(somePromise, { fallback: null, label: 'gemini' });
 *   if (dl.expired()) ...
 */

export type Deadline = {
  /** Milissegundos restantes (>=0). */
  remaining(): number;
  /** True quando o tempo acabou. */
  expired(): boolean;
  /** Promise que resolve quando o orçamento estoura (não rejeita). */
  done(): Promise<void>;
  /** AbortSignal cancelado quando o orçamento estoura. */
  signal: AbortSignal;
  /**
   * Corre `promise` contra o deadline.
   *  - Se `promise` resolver/rejeitar antes, devolve resultado/erro.
   *  - Se o deadline estourar primeiro, devolve `fallback` (ou re-lança um TimeoutError com `label`).
   */
  race<T>(
    promise: Promise<T>,
    options?: { fallback?: T; label?: string; perCallMs?: number },
  ): Promise<T>;
  /** Cancela imediatamente o deadline (ex.: cleanup ao terminar `checkRoute`). */
  cancel(): void;
};

export class DeadlineExceededError extends Error {
  constructor(label?: string) {
    super(label ? `[deadline] ${label}` : 'deadline exceeded');
    this.name = 'DeadlineExceededError';
  }
}

export function makeDeadline(totalBudgetMs: number): Deadline {
  const startedAt = Date.now();
  const totalMs = Math.max(0, Math.floor(totalBudgetMs));
  const controller = new AbortController();
  let isCancelled = false;
  const timer = setTimeout(() => {
    if (!isCancelled) controller.abort();
  }, totalMs);

  const remaining = (): number => {
    if (controller.signal.aborted) return 0;
    return Math.max(0, totalMs - (Date.now() - startedAt));
  };

  const expired = (): boolean => controller.signal.aborted || remaining() <= 0;

  const done = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (controller.signal.aborted) {
        resolve();
        return;
      }
      controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });

  const race = async <T>(
    promise: Promise<T>,
    options?: { fallback?: T; label?: string; perCallMs?: number },
  ): Promise<T> => {
    const callBudget =
      typeof options?.perCallMs === 'number'
        ? Math.max(0, Math.min(options.perCallMs, remaining()))
        : remaining();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'__deadline__'>((resolve) => {
      if (callBudget === 0) {
        resolve('__deadline__');
        return;
      }
      timeoutHandle = setTimeout(() => resolve('__deadline__'), callBudget);
      controller.signal.addEventListener(
        'abort',
        () => resolve('__deadline__'),
        { once: true },
      );
    });
    try {
      const result = (await Promise.race([promise, timedOut])) as T | '__deadline__';
      if (result === '__deadline__') {
        if ('fallback' in (options ?? {})) return options!.fallback as T;
        throw new DeadlineExceededError(options?.label);
      }
      return result;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };

  const cancel = () => {
    isCancelled = true;
    clearTimeout(timer);
  };

  return {
    remaining,
    expired,
    done,
    signal: controller.signal,
    race,
    cancel,
  };
}
