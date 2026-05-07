import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WheelmapService {
  async getNearbyAccessiblePlaces(lat: number, lng: number) {
    const url = `https://wheelmap.org/api/nodes?lat=${lat}&lon=${lng}&radius=500&api_key=${process.env.WHEELMAP_API_KEY}&per_page=20`;
    const { data } = await axios.get(url);

    return (data.results?.nodes ?? []).map((node: any) => ({
      id: node.id,
      name: node.name,
      lat: node.lat,
      lng: node.lon,
      wheelchair: node.wheelchair,
      category: node.node_type?.identifier,
    }));
  }
}
