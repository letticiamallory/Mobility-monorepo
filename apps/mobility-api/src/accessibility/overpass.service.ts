import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/** Resultado de consulta a degraus/escadas mapeados no OSM ao longo de um trecho a pé. */
export type WalkSegmentBarrierResult = {
  /** Vias ou nós com highway=steps / stairway (ou equivalente). */
  stepFeatureCount: number;
  /**
   * Vias pedestrian/footway/path com surface irregular (gravilha, terra, grama, etc.) — Fase 3.
   */
  roughSurfaceFeatureCount: number;
  /** Falha de rede / timeout / resposta inválida — não inferir “sem degraus”. */
  queryFailed: boolean;
};

const ROUGH_SURFACE_VALUES = new Set([
  'unpaved',
  'gravel',
  'fine_gravel',
  'grass',
  'dirt',
  'sand',
  'mud',
  'ground',
  'earth',
  'woodchips',
  'wood',
  'pebblestone',
]);

@Injectable()
export class OverpassService {
  private readonly logger = new Logger(OverpassService.name);

  async getAccessibilityFeatures(lat: number, lng: number, radius: number = 300) {
    const query = `
      [out:json];
      (
        node["kerb"="lowered"](around:${radius},${lat},${lng});
        node["tactile_paving"="yes"](around:${radius},${lat},${lng});
        node["highway"="crossing"]["tactile_paving"="yes"](around:${radius},${lat},${lng});
        way["sidewalk"](around:${radius},${lat},${lng});
        node["amenity"="toilets"]["wheelchair"="yes"](around:${radius},${lat},${lng});
      );
      out body;
    `;

    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const { data } = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
    const elements = data.elements ?? [];

    return {
      rampas: elements.filter((e: any) => e.tags?.kerb === 'lowered').length,
      pisotatil: elements.filter((e: any) => e.tags?.tactile_paving === 'yes').length,
      banheiros_acessiveis: elements.filter((e: any) => e.tags?.amenity === 'toilets').length,
      calcadas: elements.filter((e: any) => e.tags?.sidewalk).length,
    };
  }

  /**
   * Degraus/escadas no OSM cruzando o corredor do trecho (bbox com folga).
   * Uma única requisição Overpass por perna a pé (Fase 1).
   */
  async getWalkSegmentStepBarriers(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): Promise<WalkSegmentBarrierResult> {
    const pad = 0.00035;
    const south = Math.min(lat1, lat2) - pad;
    const north = Math.max(lat1, lat2) + pad;
    const west = Math.min(lng1, lng2) - pad;
    const east = Math.max(lng1, lng2) + pad;

    const query = `
      [out:json][timeout:12];
      (
        way["highway"="steps"](${south},${west},${north},${east});
        way["highway"="stairway"](${south},${west},${north},${east});
        node["highway"="steps"](${south},${west},${north},${east});
        way["highway"~"^(footway|path|pedestrian)$"]["surface"~"^(unpaved|gravel|fine_gravel|grass|dirt|sand|mud|ground|earth|woodchips|wood|pebblestone)$"](${south},${west},${north},${east});
      );
      out tags;
    `;

    try {
      const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
      const { data } = await axios.get(url, {
        headers: { Accept: 'application/json' },
        timeout: 14_000,
      });
      const elements = data?.elements ?? [];
      let stepFeatureCount = 0;
      let roughSurfaceFeatureCount = 0;
      for (const e of elements as {
        tags?: { highway?: string; surface?: string };
      }[]) {
        const h = `${e.tags?.highway ?? ''}`.toLowerCase();
        const surf = `${e.tags?.surface ?? ''}`.toLowerCase();
        if (h === 'steps' || h === 'stairway') {
          stepFeatureCount += 1;
          continue;
        }
        if (
          (h === 'footway' || h === 'path' || h === 'pedestrian') &&
          ROUGH_SURFACE_VALUES.has(surf)
        ) {
          roughSurfaceFeatureCount += 1;
        }
      }
      return { stepFeatureCount, roughSurfaceFeatureCount, queryFailed: false };
    } catch (err) {
      this.logger.warn(
        `[Overpass] getWalkSegmentStepBarriers: ${(err as Error).message}`,
      );
      return {
        stepFeatureCount: 0,
        roughSurfaceFeatureCount: 0,
        queryFailed: true,
      };
    }
  }
}
