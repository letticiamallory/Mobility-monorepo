import type { LinesRegionId } from '../utils/lines-region';

export type LineItem = {
  id: string;
  /** Região dos dados (API mobility-api). */
  region?: LinesRegionId;
  type: 'bus' | 'metro';
  code: string;
  name: string;
  origin: string;
  destination: string;
  via: string | null;
  accessible: boolean;
  operator: string;
  color: string;
  schedules: string[];
  alert?: 'green' | 'yellow' | 'red' | null;
  alertText?: string;
};

/** Paradas usadas no mapa / sheet da tela de linhas (não confundir com `MOCK_STATIONS` da tela de estações). */
export type StationStop = {
  id: string;
  name: string;
  lines: string[];
  nextBus: string | null;
  lat: number;
  lng: number;
};

export const MOCK_LINE_STOPS: StationStop[] = [
  { id: '1', name: 'Terminal Central', lines: ['1501', '1701', '2201', '6201'], nextBus: '09:15', lat: -16.729, lng: -43.8617 },
  { id: '2', name: 'Parada Ibituruna', lines: ['5801', '6901'], nextBus: '09:22', lat: -16.7089, lng: -43.8723 },
  { id: '3', name: 'Parada Montes Claros Shopping', lines: ['2603', '3301'], nextBus: '09:30', lat: -16.7445, lng: -43.8534 },
  { id: '4', name: 'Parada Unimontes', lines: ['6901', '7101'], nextBus: '09:18', lat: -16.7012, lng: -43.8456 },
  { id: '5', name: 'Parada Hospital Aroldo Tourinho', lines: ['4601', '5801'], nextBus: '09:45', lat: -16.7234, lng: -43.8789 },
  { id: '6', name: 'Parada Parque Cândido Portinari', lines: ['2201', '3301'], nextBus: null, lat: -16.7167, lng: -43.8345 },
  { id: '7', name: 'Parada Rodoviária', lines: ['1601', '5601'], nextBus: '09:50', lat: -16.7389, lng: -43.8678 },
  { id: '8', name: 'Parada UFMG', lines: ['2201', '5101'], nextBus: '10:00', lat: -16.6978, lng: -43.8512 },
];

export const MOCK_LINES: LineItem[] = [
  { id: '1', type: 'bus', code: '1501', name: 'Vila Atlantida / Vila Analia', origin: 'Vila Atlantida', destination: 'Vila Analia', via: null, accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: null, schedules: ['05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'] },
  { id: '2', type: 'bus', code: '1701', name: 'Castelo Branco / Sao Geraldo', origin: 'Castelo Branco', destination: 'Sao Geraldo', via: null, accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: 'green', schedules: ['05:45', '06:15', '07:00', '08:00', '09:00', '10:00', '12:00', '14:00', '17:30', '18:30'] },
  { id: '3', type: 'bus', code: '2201', name: 'UFMG / Centro', origin: 'UFMG', destination: 'Centro (Prefeitura)', via: 'JK e Planalto', accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: null, schedules: ['06:00', '06:30', '07:00', '07:30', '08:00', '09:00', '10:00', '12:00', '13:00', '17:00', '18:00', '19:00'] },
  { id: '4', type: 'bus', code: '2603', name: 'Jaragua II / Santo Amaro', origin: 'Jaragua II', destination: 'Santo Amaro', via: null, accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: null, schedules: ['06:00', '07:00', '08:00', '10:00', '12:00', '14:00', '17:00', '18:00'] },
  { id: '5', type: 'bus', code: '3301', name: 'Jardim Primavera / Centro', origin: 'Jardim Primavera', destination: 'Centro (Prefeitura)', via: 'Aeroporto', accessible: false, operator: 'MOC BUS', color: '#0057A8', alert: 'yellow', alertText: 'Desvio temporário na Av. Osmane Barbosa', schedules: ['06:00', '07:00', '09:00', '12:00', '15:00', '17:00', '18:00'] },
  { id: '6', type: 'bus', code: '4601', name: 'Independencia / N. S. das Gracas', origin: 'Independencia', destination: 'Nossa Senhora das Gracas', via: null, accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: null, schedules: ['05:30', '06:30', '07:30', '09:00', '12:00', '15:00', '17:00', '18:30'] },
  { id: '7', type: 'bus', code: '5801', name: 'Vila Sion II / Vila Mauriceia', origin: 'Vila Sion II', destination: 'Vila Mauriceia', via: 'Santa Rita e Ibituruna', accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: 'red', alertText: 'Sem serviço no momento', schedules: ['06:00', '07:00', '08:00', '10:00', '12:00', '14:00', '17:00', '18:00', '19:00'] },
  { id: '8', type: 'bus', code: '6201', name: 'Renascenca / Centro', origin: 'Renascenca', destination: 'Centro', via: null, accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: null, schedules: ['05:45', '06:15', '07:15', '09:00', '12:00', '15:00', '17:15', '18:15'] },
  { id: '9', type: 'bus', code: '6901', name: 'Maracana / Vila Oliveira', origin: 'Maracana', destination: 'Vila Oliveira', via: 'Unimontes', accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: 'green', schedules: ['06:00', '07:00', '08:00', '10:00', '12:00', '14:00', '17:00', '18:00'] },
  { id: '10', type: 'bus', code: '7101', name: 'Major Prates / Vila Sao Francisco', origin: 'Major Prates', destination: 'Vila Sao Francisco de Assis', via: null, accessible: true, operator: 'MOC BUS', color: '#0057A8', alert: null, schedules: ['06:00', '07:00', '09:00', '12:00', '15:00', '17:00', '18:00'] },
];
