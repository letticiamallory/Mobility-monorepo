import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';
import { Places } from './places.entity';
import { FoursquareModule } from '../foursquare/foursquare.module';

@Module({
  imports: [TypeOrmModule.forFeature([Places]), FoursquareModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
