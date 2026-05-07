import { Controller, Get, ParseFloatPipe, Query } from '@nestjs/common';
import { UberService } from './uber.service';

@Controller('uber')
export class UberController {
  constructor(private readonly uberService: UberService) {}

  @Get('estimate')
  async getEstimate(
    @Query('originLat', ParseFloatPipe) originLat: number,
    @Query('originLng', ParseFloatPipe) originLng: number,
    @Query('destLat', ParseFloatPipe) destLat: number,
    @Query('destLng', ParseFloatPipe) destLng: number,
  ) {
    return this.uberService.getEstimate(
      { lat: originLat, lng: originLng },
      { lat: destLat, lng: destLng },
    );
  }

  @Get('deeplink')
  getDeepLink(
    @Query('originLat', ParseFloatPipe) originLat: number,
    @Query('originLng', ParseFloatPipe) originLng: number,
    @Query('destLat', ParseFloatPipe) destLat: number,
    @Query('destLng', ParseFloatPipe) destLng: number,
  ) {
    return {
      deeplink: this.uberService.getDeepLink(
        { lat: originLat, lng: originLng },
        { lat: destLat, lng: destLng },
      ),
    };
  }
}
