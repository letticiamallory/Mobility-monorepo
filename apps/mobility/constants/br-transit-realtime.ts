/**
 * Feeds GTFS-RT (vehicle positions) e regiões atendidas.
 * URLs públicas documentadas em portais de dados abertos quando existirem.
 * Cidades sem URL ainda aparecem para detecção regional (ex.: Montes Claros — aguardando feed oficial).
 */

export type TransitRealtimeRegion = {
  id: string;
  name: string;
  state: string;
  /** Centro aproximado para matching regional */
  center: { latitude: number; longitude: number };
  /** Raio útil em graus (~0.15 ≈ 15–20 km em MG) */
  latSpan: number;
  lngSpan: number;
  /**
   * URL protobuf GTFS-RT VehiclePositions, ou null se ainda não há feed público estável.
   * BH (Mobilibus): portal dados.pbh.gov.br
   */
  vehiclePositionsUrl: string | null;
  notes?: string;
};

export const BR_TRANSIT_REALTIME_REGIONS: TransitRealtimeRegion[] = [
  {
    id: 'belo-horizonte-mg',
    name: 'Belo Horizonte',
    state: 'MG',
    center: { latitude: -19.9167, longitude: -43.9345 },
    latSpan: 0.35,
    lngSpan: 0.35,
    vehiclePositionsUrl:
      'http://realtime4.mobilibus.com/web/4ch6j/vehicle-positions?accesskey=982a57efd77a9462bf1665696fb25984',
    notes: 'GTFS-RT oficial PBH / Mobilibus',
  },
  {
    id: 'montes-claros-mg',
    name: 'Montes Claros',
    state: 'MG',
    center: { latitude: -16.728, longitude: -43.8578 },
    latSpan: 0.22,
    lngSpan: 0.22,
    vehiclePositionsUrl: null,
    notes:
      'Sem feed GTFS-RT público estável no portal (2025). MCTrans/consórcio: integrar quando disponível.',
  },
  {
    id: 'uberlandia-mg',
    name: 'Uberlândia',
    state: 'MG',
    center: { latitude: -18.9186, longitude: -48.2772 },
    latSpan: 0.2,
    lngSpan: 0.2,
    vehiclePositionsUrl: null,
    notes: 'Reservado — verificar SETTRAN / dados abertos municipais.',
  },
  {
    id: 'juiz-de-fora-mg',
    name: 'Juiz de Fora',
    state: 'MG',
    center: { latitude: -21.7642, longitude: -43.3496 },
    latSpan: 0.18,
    lngSpan: 0.18,
    vehiclePositionsUrl: null,
  },
  {
    id: 'curitiba-pr',
    name: 'Curitiba',
    state: 'PR',
    center: { latitude: -25.4284, longitude: -49.2733 },
    latSpan: 0.3,
    lngSpan: 0.3,
    vehiclePositionsUrl: null,
    notes: 'URBS costuma expor tempo real via serviços próprios; protobuf público não padronizado aqui.',
  },
  {
    id: 'porto-alegre-rs',
    name: 'Porto Alegre',
    state: 'RS',
    center: { latitude: -30.0346, longitude: -51.2177 },
    latSpan: 0.28,
    lngSpan: 0.28,
    vehiclePositionsUrl: null,
    notes: 'GTFS estático em dados.poa; RT depende de contrato/API EPTC.',
  },
  {
    id: 'fortaleza-ce',
    name: 'Fortaleza',
    state: 'CE',
    center: { latitude: -3.7319, longitude: -38.5267 },
    latSpan: 0.32,
    lngSpan: 0.32,
    vehiclePositionsUrl: null,
  },
  {
    id: 'recife-pe',
    name: 'Recife',
    state: 'PE',
    center: { latitude: -8.0476, longitude: -34.877 },
    latSpan: 0.28,
    lngSpan: 0.28,
    vehiclePositionsUrl: null,
  },
  {
    id: 'salvador-ba',
    name: 'Salvador',
    state: 'BA',
    center: { latitude: -12.9777, longitude: -38.5016 },
    latSpan: 0.3,
    lngSpan: 0.3,
    vehiclePositionsUrl: null,
  },
  {
    id: 'brasilia-df',
    name: 'Brasília',
    state: 'DF',
    center: { latitude: -15.7939, longitude: -47.8828 },
    latSpan: 0.45,
    lngSpan: 0.45,
    vehiclePositionsUrl: null,
  },
  {
    id: 'florianopolis-sc',
    name: 'Florianópolis',
    state: 'SC',
    center: { latitude: -27.5954, longitude: -48.548 },
    latSpan: 0.22,
    lngSpan: 0.22,
    vehiclePositionsUrl: null,
  },
  {
    id: 'vitoria-es',
    name: 'Vitória',
    state: 'ES',
    center: { latitude: -20.3155, longitude: -40.3128 },
    latSpan: 0.2,
    lngSpan: 0.2,
    vehiclePositionsUrl: null,
  },
  {
    id: 'campinas-sp',
    name: 'Campinas',
    state: 'SP',
    center: { latitude: -22.9056, longitude: -47.0608 },
    latSpan: 0.28,
    lngSpan: 0.28,
    vehiclePositionsUrl: null,
  },
  {
    id: 'sao-paulo-sp',
    name: 'São Paulo',
    state: 'SP',
    center: { latitude: -23.5505, longitude: -46.6333 },
    latSpan: 0.55,
    lngSpan: 0.55,
    vehiclePositionsUrl: null,
    notes: 'SPTrans — feeds costumam exigir cadastro/chave; não incluído por padrão.',
  },
  {
    id: 'rio-de-janeiro-rj',
    name: 'Rio de Janeiro',
    state: 'RJ',
    center: { latitude: -22.9068, longitude: -43.1729 },
    latSpan: 0.45,
    lngSpan: 0.45,
    vehiclePositionsUrl: null,
  },
];

export function regionsCoveringPoint(lat: number, lng: number): TransitRealtimeRegion[] {
  return BR_TRANSIT_REALTIME_REGIONS.filter((r) => {
    const dLat = Math.abs(lat - r.center.latitude);
    const dLng = Math.abs(lng - r.center.longitude);
    return dLat <= r.latSpan / 2 + 0.05 && dLng <= r.lngSpan / 2 + 0.05;
  });
}

export function regionsWithActiveFeedAt(lat: number, lng: number): TransitRealtimeRegion[] {
  return regionsCoveringPoint(lat, lng).filter((r) => r.vehiclePositionsUrl != null);
}
