import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class HereService {
  async getAccessibleRoute(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ) {
    const url = `https://router.hereapi.com/v8/routes?transportMode=pedestrian&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&return=summary,polyline,actions&pedestrian[obstacles]=avoid&apiKey=${process.env.HERE_API_KEY}`;
    const { data } = await axios.get(url);
    return data.routes?.[0] ?? null;
  }

  async getNearbyAccessiblePlaces(lat: number, lng: number) {
    const url = `https://discover.search.hereapi.com/v1/browse?at=${lat},${lng}&limit=20&categories=100-1000-0000&apiKey=${process.env.HERE_API_KEY}`;
    const { data } = await axios.get(url);
    return (data.items ?? []).map((item: any) => ({
      id: item.id,
      name: item.title,
      lat: item.position.lat,
      lng: item.position.lng,
      address: item.address.label,
      distance: item.distance,
    }));
  }
}
