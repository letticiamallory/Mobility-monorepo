import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoCache } from './photo-cache.entity';
import { PhotoCacheService } from './photo-cache.service';

@Module({
  imports: [TypeOrmModule.forFeature([PhotoCache])],
  providers: [PhotoCacheService],
  exports: [PhotoCacheService],
})
export class PhotoCacheModule {}
