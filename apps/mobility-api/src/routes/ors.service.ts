import { Injectable, Logger } from '@nestjs/common';

interface OrsStep {
  instruction: string;
}

interface OrsGeometry {
  coordinates: number[][];
}

interface OrsRoute {
  summary: {
    distance: number;
    duration: number;
  };
  segments: {
    steps: OrsStep[];
  }[];
  geometry: OrsGeometry;
}

interface OrsResponse {
  routes: OrsRoute[];
}

export interface OrsRouteResult {
  distance_km: string;
  /** Metros — GraphHopper/ORS summary.distance. */
  distance_meters: number;
  duration_minutes: number;
  instructions: string[];
  coordinates: OrsCoordinate[];
}

interface OrsCoordinate {
  latitude: number;
  longitude: number;
}

@Injectable()
export class OrsService {
  private readonly logger = new Logger(OrsService.name);

  async calculateRoute(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
  ): Promise<OrsRouteResult | null> {
    const response = await fetch(
      'https://api.openrouteservice.org/v2/directions/wheelchair',
      {
        method: 'POST',
        headers: {
          Authorization: process.env.ORS_API_KEY ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [originLon, originLat],
            [destLon, destLat],
          ],
          language: 'pt',
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ORS API error: ${response.status}`);
    }

    const data = (await response.json()) as OrsResponse;
    this.logger.log(`ORS response: ${JSON.stringify(data)}`);

    if (!data.routes || data.routes.length === 0) {
      return null;
    }

    const route = data.routes[0];
    const distanceM = Number(route.summary?.distance ?? 0);
    return {
      distance_km: (distanceM / 1000).toFixed(2),
      distance_meters: Number.isFinite(distanceM) ? distanceM : 0,
      duration_minutes: Math.ceil(route.summary.duration / 60),
      instructions: route.segments[0].steps.map(
        (step: OrsStep) => step.instruction,
      ),
      coordinates: route.geometry.coordinates.map(
        ([longitude, latitude]: number[]) => ({
          latitude,
          longitude,
        }),
      ),
    };
  }
}
