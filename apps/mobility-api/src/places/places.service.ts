import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Places } from './places.entity';
import { CreatePlaceDto } from './dto/create-place.dto';
import { UpdatePlaceDto } from './dto/update-place.dto';
import { FoursquareService } from '../foursquare/foursquare.service';

@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(Places)
    private placesRepository: Repository<Places>,
    private readonly foursquareService: FoursquareService,
  ) {}

  async newPlace(dto: CreatePlaceDto): Promise<Places> {
    const place = this.placesRepository.create(dto);
    return this.placesRepository.save(place);
  }

  async findAll(): Promise<Places[]> {
    return this.placesRepository.find();
  }

  async getById(id: number): Promise<Places> {
    const place = await this.placesRepository.findOne({ where: { id } });

    if (!place) {
      throw new NotFoundException(`Local com id ${id} não encontrado`);
    }

    return place;
  }

  async updateById(id: number, dto: UpdatePlaceDto): Promise<Places> {
    await this.placesRepository.update(id, dto);
    return this.getById(id);
  }

  async getNearbyPlaces(lat: number, lng: number) {
    return this.foursquareService.getNearbyPlaces(lat, lng);
  }

  async getPlaceDetails(id: string) {
    if (/^\d+$/.test(id)) {
      return this.getById(Number(id));
    }

    return this.foursquareService.getPlaceDetails(id);
  }
}
