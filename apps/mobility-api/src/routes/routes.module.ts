import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { Routes } from './routes.entity';
import { OrsService } from './ors.service';
import { NominatimService } from './nominatim.service';
import { GeminiService } from './gemini.service';
import { GoogleRoutesService } from './google-routes.service';
import { User } from '../users/users.entity';
import { ElevationModule } from '../elevation/elevation.module';
import { WeatherModule } from '../weather/weather.module';
import { AccessibilityModule } from '../accessibility/accessibility.module';
import { HereModule } from '../here/here.module';
import { FoursquareModule } from '../foursquare/foursquare.module';
import { UberModule } from '../uber/uber.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PhotoCacheModule } from '../cache/photo-cache.module';
import { OtpService } from './otp.service';
import { WalkAccessibilityEngineService } from './walk-accessibility-engine.service';
import { RouteAccessibilityFusionService } from './route-accessibility-fusion.service';
import { AccessibilityLlmAgentService } from './accessibility-llm-agent.service';

@Module({
  imports: [
    PhotoCacheModule,
    TypeOrmModule.forFeature([Routes, User]),
    ElevationModule,
    WeatherModule,
    AccessibilityModule,
    HereModule,
    FoursquareModule,
    UberModule,
    NotificationsModule,
  ],
  controllers: [RoutesController],
  providers: [
    RoutesService,
    OrsService,
    NominatimService,
    GeminiService,
    GoogleRoutesService,
    OtpService,
    WalkAccessibilityEngineService,
    RouteAccessibilityFusionService,
    AccessibilityLlmAgentService,
  ],
})
export class RoutesModule {}
