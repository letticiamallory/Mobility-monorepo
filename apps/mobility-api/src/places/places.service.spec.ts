import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FoursquareService } from '../foursquare/foursquare.service';
import { Places } from './places.entity';
import { PlacesService } from './places.service';

describe('PlacesService', () => {
  let service: PlacesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlacesService,
        { provide: getRepositoryToken(Places), useValue: {} },
        { provide: FoursquareService, useValue: {} },
      ],
    }).compile();

    service = module.get<PlacesService>(PlacesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
