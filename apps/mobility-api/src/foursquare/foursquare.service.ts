import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class FoursquareService {
  async getNearbyPlaces(lat: number, lng: number) {
    const url = `https://api.foursquare.com/v3/places/nearby?ll=${lat},${lng}&limit=20`;
    const { data } = await axios.get(url, {
      headers: {
        Authorization: process.env.FOURSQUARE_API_KEY,
        Accept: 'application/json',
      },
    });

    return (data.results ?? []).map((place: any) => ({
      id: place.fsq_id,
      name: place.name,
      lat: place.geocodes?.main?.latitude,
      lng: place.geocodes?.main?.longitude,
      category: place.categories?.[0]?.name,
      distance: place.distance,
    }));
  }

  async getPlaceDetails(fsqId: string) {
    const url = `https://api.foursquare.com/v3/places/${fsqId}?fields=name,location,rating,photos,tips,accessibility`;
    const { data } = await axios.get(url, {
      headers: {
        Authorization: process.env.FOURSQUARE_API_KEY,
        Accept: 'application/json',
      },
    });
    return data;
  }
}
