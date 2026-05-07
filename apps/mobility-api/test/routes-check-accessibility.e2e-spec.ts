import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { User } from '../src/users/users.entity';
import { Routes } from '../src/routes/routes.entity';
import { GoogleRoutesService } from '../src/routes/google-routes.service';
import { NominatimService } from '../src/routes/nominatim.service';
import { OtpService } from '../src/routes/otp.service';
import { GeminiService } from '../src/routes/gemini.service';
import { ElevationService } from '../src/elevation/elevation.service';
import { OverpassService } from '../src/accessibility/overpass.service';
import { OrsService } from '../src/routes/ors.service';

/**
 * Garante que POST /routes/check inclui accessibility_report nos trechos walk
 * (Fase 1) sem depender de chamadas reais a Google/OTP/Overpass/Gemini.
 */
describe('POST /routes/check — accessibility_report (e2e)', () => {
  let app: INestApplication;

  const userId = 4242;
  const mockUser = {
    id: userId,
    fcm_token: null as string | null,
    disability_type: 'wheelchair',
    email: 'e2e-accessibility@test.local',
  };

  const walkStage = {
    stage: 1,
    mode: 'walk',
    instruction: 'E2E trecho a pé',
    distance: '120 m',
    duration: '2 min',
    location: { lat: -23.55, lng: -46.63 },
    end_location: { lat: -23.551, lng: -46.631 },
    accessible: true,
    warning: null as string | null,
    street_view_image: null as string | null,
  };

  const mockRouteOption = {
    route_id: 1,
    total_distance: '200 m',
    total_duration: '10 min',
    stages: [walkStage],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
          context.switchToHttp().getRequest().user = { id: userId };
          return true;
        },
      })
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        findOne: jest.fn().mockResolvedValue(mockUser),
      })
      .overrideProvider(getRepositoryToken(Routes))
      .useValue({
        create: jest.fn((d: object) => d),
        save: jest.fn().mockImplementation((d: Record<string, unknown>) =>
          Promise.resolve({
            id: 9001,
            created_at: new Date().toISOString(),
            ...d,
          }),
        ),
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('information_schema.columns') && sql.includes('accompanied')) {
            return Promise.resolve([{ x: 1 }]);
          }
          return Promise.resolve([]);
        }),
      })
      .overrideProvider(GoogleRoutesService)
      .useValue({
        getRouteOptions: jest.fn().mockResolvedValue([mockRouteOption]),
        getWalkingRouteOptions: jest.fn().mockResolvedValue([mockRouteOption]),
      })
      .overrideProvider(NominatimService)
      .useValue({
        getCoordinates: jest
          .fn()
          .mockResolvedValueOnce({ lat: -23.5, lon: -46.6 })
          .mockResolvedValueOnce({ lat: -23.51, lon: -46.61 }),
      })
      .overrideProvider(OtpService)
      .useValue({
        planRoute: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(GeminiService)
      .useValue({
        resolveWalkStageImageUrls: jest.fn().mockResolvedValue([]),
        analyzeAccessibilityAt: jest
          .fn()
          .mockResolvedValue({ accessible: true, warning: null }),
        resolveTransitStopPhoto: jest.fn().mockResolvedValue(null),
        resolveStageStreetViewImage: jest.fn().mockResolvedValue(null),
      })
      .overrideProvider(ElevationService)
      .useValue({
        getElevation: jest.fn().mockResolvedValue([
          { lat: -23.55, lng: -46.63, elevation: 720, accessible: true },
          { lat: -23.551, lng: -46.631, elevation: 720, accessible: true },
        ]),
      })
      .overrideProvider(OverpassService)
      .useValue({
        getAccessibilityFeatures: jest.fn().mockResolvedValue({
          rampas: 0,
          pisotatil: 0,
          banheiros_acessiveis: 0,
          calcadas: 0,
        }),
        getWalkSegmentStepBarriers: jest
          .fn()
          .mockResolvedValue({
            stepFeatureCount: 0,
            roughSurfaceFeatureCount: 0,
            queryFailed: false,
          }),
      })
      .overrideProvider(OrsService)
      .useValue({
        calculateRoute: jest.fn().mockResolvedValue({
          distance_km: '0.05',
          distance_meters: 50,
          duration_minutes: 1,
          instructions: [],
          coordinates: [],
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('inclui accessibility_report em estágios walk na resposta', async () => {
    const res = await request(app.getHttpServer())
      .post('/routes/check')
      .set('Authorization', 'Bearer e2e-mock-token')
      .send({
        user_id: userId,
        origin: 'Ponto A E2E',
        destination: 'Ponto B E2E',
        transport_type: 'bus',
      })
      .expect(200);

    const body = res.body as {
      routes_alone?: { stages?: unknown[] }[];
      routes_companied?: { stages?: unknown[] }[];
    };
    const routes = [
      ...(body.routes_alone ?? []),
      ...(body.routes_companied ?? []),
    ];
    expect(routes.length).toBeGreaterThan(0);

    const walkStages = routes.flatMap((r) =>
      (r.stages ?? []).filter(
        (s: { mode?: string }) =>
          `${s.mode ?? ''}`.toLowerCase() === 'walk' ||
          `${s.mode ?? ''}`.toLowerCase() === 'walking' ||
          `${s.mode ?? ''}`.toLowerCase() === 'foot',
      ),
    );
    expect(walkStages.length).toBeGreaterThan(0);

    for (const st of walkStages) {
      expect(st).toHaveProperty('accessibility_report');
      const ar = (st as { accessibility_report: { confidence?: string; blockers?: unknown[] } })
        .accessibility_report;
      expect(ar).toBeDefined();
      expect(ar).toHaveProperty('confidence');
      expect(Array.isArray(ar.blockers)).toBe(true);
    }
  });
});
