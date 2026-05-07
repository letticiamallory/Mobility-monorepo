import { AccessibilityInfo, Platform } from 'react-native';
import { useEffect, useState } from 'react';

/**
 * Reflects OS “reduce motion” (iOS/Android). Use to shorten or skip non-essential animations.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS === 'web') {
      if (typeof globalThis === 'undefined' || !('matchMedia' in globalThis)) {
        return undefined;
      }
      const mq = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
      const apply = () => {
        if (!cancelled) setReduce(mq.matches);
      };
      apply();
      mq.addEventListener('change', apply);
      return () => {
        cancelled = true;
        mq.removeEventListener('change', apply);
      };
    }

    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduce(v);
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      if (!cancelled) setReduce(v);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduce;
}
