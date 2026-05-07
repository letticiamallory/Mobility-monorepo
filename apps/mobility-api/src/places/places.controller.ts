import {
  Body,
  Controller,
  Get,
  Param,
  Query,
  Post,
  Put,
  UseGuards,
  ParseFloatPipe,
} from '@nestjs/common';
import { PlacesService } from './places.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePlaceDto } from './dto/create-place.dto';
import { UpdatePlaceDto } from './dto/update-place.dto';

@UseGuards(JwtAuthGuard)
@Controller('places')
export class PlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @Post()
  async newPlace(@Body() body: CreatePlaceDto) {
    return this.placesService.newPlace(body);
  }

  @Get()
  async findAll() {
    return this.placesService.findAll();
  }

  @Get('nearby')
  async getNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ) {
    return this.placesService.getNearbyPlaces(lat, lng);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.placesService.getPlaceDetails(id);
  }

  @Put(':id')
  async updateById(
    @Param('id') id: string,
    @Body() body: UpdatePlaceDto,
  ) {
    return this.placesService.updateById(Number(id), body);
  }
}
