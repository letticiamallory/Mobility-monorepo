import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ElevationService {
  async getElevation(points: { lat: number; lng: number }[]) {
    if (points.length === 0) {
      return [];
    }

    const locations = points.map((p) => `${p.lat},${p.lng}`).join('|');
    const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${locations}&key=${apiKey}`;
    const { data } = await axios.get(url);

    return (data.results ?? []).map((r: any) => ({
      lat: r.location.lat,
      lng: r.location.lng,
      elevation: r.elevation,
      accessible: true,
    }));
  }
}
