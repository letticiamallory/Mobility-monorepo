import { Controller, Get, ParseFloatPipe, Query } from '@nestjs/common';
import { WheelmapService } from './wheelmap.service';

@Controller('accessibility')
export class AccessibilityController {
  constructor(private readonly wheelmapService: WheelmapService) {}

  @Get('nearby')
  async getNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ) {
    return this.wheelmapService.getNearbyAccessiblePlaces(lat, lng);
  }
}
