import { DeadlineExceededError, makeDeadline } from './deadline.util';

describe('deadline.util', () => {
  it('resolve normalmente quando a promise é rápida', async () => {
    const dl = makeDeadline(500);
    const result = await dl.race(Promise.resolve(42), { label: 'fast' });
    expect(result).toBe(42);
    dl.cancel();
  });

  it('devolve fallback quando a promise demora além do orçamento', async () => {
    const dl = makeDeadline(50);
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 500));
    const result = await dl.race(slow, { fallback: -1, label: 'slow' });
    expect(result).toBe(-1);
    dl.cancel();
  });

  it('expired() retorna true após orçamento estourar', async () => {
    const dl = makeDeadline(20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dl.expired()).toBe(true);
    dl.cancel();
  });

  it('lança DeadlineExceededError quando não há fallback', async () => {
    const dl = makeDeadline(20);
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 200));
    await expect(dl.race(slow, { label: 'no_fallback' })).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );
    dl.cancel();
  });
});
