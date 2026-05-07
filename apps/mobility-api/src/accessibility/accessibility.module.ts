import { Module } from '@nestjs/common';
import { AccessibilityController } from './accessibility.controller';
import { OverpassService } from './overpass.service';
import { WheelmapService } from './wheelmap.service';

@Module({
  controllers: [AccessibilityController],
  providers: [WheelmapService, OverpassService],
  exports: [WheelmapService, OverpassService],
})
export class AccessibilityModule {}
