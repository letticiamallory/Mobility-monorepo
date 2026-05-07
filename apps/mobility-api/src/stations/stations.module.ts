import { Module } from '@nestjs/common';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';
import { PhotoCacheModule } from '../cache/photo-cache.module';
import { StationsOsmCacheService } from './stations-osm-cache.service';

@Module({
  imports: [PhotoCacheModule],
  controllers: [StationsController],
  providers: [StationsService, StationsOsmCacheService],
})
export class StationsModule {}
