import { Logger } from '@nestjs/common';

/**
 * Marca duração cumulativa desde a criação — útil para diagnosticar latência por fase em POST /routes/check.
 */
export class RouteCheckTelemetry {
  private readonly t0 = Date.now();

  constructor(
    private readonly logger: Logger,
    private readonly requestId: string,
  ) {}

  mark(phase: string, meta?: Record<string, unknown>): void {
    const elapsedMs = Date.now() - this.t0;
    this.logger.log(
      `[routeCheckTelemetry] ${JSON.stringify({
        requestId: this.requestId,
        phase,
        elapsedMs,
        ...meta,
      })}`,
    );
  }
}

export function makeRouteCheckRequestId(userId: number): string {
  return `u${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
