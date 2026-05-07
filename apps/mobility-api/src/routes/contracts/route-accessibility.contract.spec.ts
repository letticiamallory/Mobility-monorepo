import type {
  LegAccessibilityBlocker,
  LegAccessibilityReport,
  SearchProfile,
} from './route-accessibility.contract';

/** Garante que o contrato Fase 0 compila e aceita objetos típicos. */
describe('route-accessibility.contract (tipos)', () => {
  it('monta LegAccessibilityReport mínimo', () => {
    const blocker: LegAccessibilityBlocker = {
      type: 'missing_geometry',
      severity: 'high',
      detail: 'sem coords',
    };
    const report: LegAccessibilityReport = {
      stageIndex: 0,
      confidence: 'low',
      blockers: [blocker],
      sources: ['policy'],
    };
    expect(report.confidence).toBe('low');
    expect(report.blockers[0].type).toBe('missing_geometry');
  });

  it('SearchProfile é alone | companied', () => {
    const a: SearchProfile = 'alone';
    const b: SearchProfile = 'companied';
    expect(a).not.toBe(b);
  });
});
