import { Controller, Get, ParseFloatPipe, Query } from '@nestjs/common';
import { HereService } from './here.service';

@Controller('here')
export class HereController {
  constructor(private readonly hereService: HereService) {}

  @Get('nearby')
  async getNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ) {
    return this.hereService.getNearbyAccessiblePlaces(lat, lng);
  }
}
