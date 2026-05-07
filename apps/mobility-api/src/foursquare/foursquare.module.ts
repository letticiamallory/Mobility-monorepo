import { Module } from '@nestjs/common';
import { FoursquareService } from './foursquare.service';

@Module({
  providers: [FoursquareService],
  exports: [FoursquareService],
})
export class FoursquareModule {}
