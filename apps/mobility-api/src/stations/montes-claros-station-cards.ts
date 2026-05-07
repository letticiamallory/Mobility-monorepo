/**
 * Cards enriquecidos para as ~20 paradas retornadas pelo Overpass em Montes Claros.
 * Endereços: geocodificação reversa (Nominatim) nas coordenadas dos nós/ways OSM.
 * Linhas: números usados no transporte urbano local (referência pública tipo onibusmoc / prefeitura).
 * nextBus: horários ilustrativos (não é tempo real).
 */
export type MontesClarosCardFields = {
  name: string;
  address: string;
  lines: string[];
  nextBus: string | null;
  accessible: boolean;
};

/** Chave = id OSM no formato retornado pelo cache (`node/123` ou `way/456`). */
export const MONTES_CLAROS_STATION_CARDS: Record<string, MontesClarosCardFields> = {
  'node/1726839947': {
    name: 'Rodoviária de Montes Claros',
    address: 'Praça Presidente Tancredo Neves · Canelas II',
    lines: ['1601', '5601', '5802', '6201'],
    nextBus: '08:48',
    accessible: true,
  },
  'node/4321043453': {
    name: 'Parada Av. Donato Quintino',
    address: 'Avenida Donato Quintino · Canelas II',
    lines: ['2603', '3301', '5801'],
    nextBus: '08:55',
    accessible: true,
  },
  'node/4321043454': {
    name: 'Parada Av. Donato Quintino II',
    address: 'Avenida Donato Quintino · Canelas II',
    lines: ['2603', '3302', '5901'],
    nextBus: '09:02',
    accessible: true,
  },
  'node/4321201703': {
    name: 'Parada Av. Coronel Prates',
    address: 'Avenida Coronel Prates · Centro',
    lines: ['7101', '8801', '4701'],
    nextBus: '09:10',
    accessible: true,
  },
  'node/4323567506': {
    name: 'Parada Cândida Câmara',
    address: 'Avenida Mestra Fininha da Silveira · Candida Câmara',
    lines: ['2603', '3301', '4601'],
    nextBus: '09:18',
    accessible: true,
  },
  'node/4325991800': {
    name: 'Parada Av. Santos Dumont',
    address: 'Avenida Santos Dumont · Centro',
    lines: ['2201', '6604', '1501'],
    nextBus: '09:25',
    accessible: true,
  },
  'node/4977763203': {
    name: 'Parada Contorno Norte (BR-251)',
    address: 'BR-251 · BR-365',
    lines: ['6404', '8201', '6604'],
    nextBus: '09:35',
    accessible: false,
  },
  'node/6393733454': {
    name: 'Parada Av. Valdomiro Marcondes',
    address: 'Avenida Valdomiro Marcondes de Oliveira · Ibituruna',
    lines: ['5801', '6901', '8801'],
    nextBus: '08:42',
    accessible: true,
  },
  'node/6393733455': {
    name: 'Parada Av. Herlindo Silveira',
    address: 'Avenida Herlindo Silveira · Ibituruna',
    lines: ['5803', '6901', '7103'],
    nextBus: '08:58',
    accessible: true,
  },
  'node/7820431251': {
    name: 'Ponto de Apoio - Posto Via Montes',
    address: 'Avenida Doutor Mário Tourinho · Santo Amaro',
    lines: ['2603', '4701', '5702'],
    nextBus: '09:05',
    accessible: true,
  },
  'node/8715796871': {
    name: 'Parada Rua Bruxelas',
    address: 'Rua Bruxelas · Ibituruna',
    lines: ['5801', '5902', '2203'],
    nextBus: '09:12',
    accessible: true,
  },
  'node/13226885970': {
    name: 'Parada Av. Amynthas Jacques',
    address: 'Avenida Amynthas Jacques de Moraes · Vila Castelo Branco',
    lines: ['1701', '2203', '5101'],
    nextBus: '08:35',
    accessible: true,
  },
  'node/13255986856': {
    name: 'Parada Cidade Industrial',
    address: 'Avenida Lincoln Alves dos Santos · Cidade Industrial',
    lines: ['4603', '6404', '6604'],
    nextBus: '09:40',
    accessible: true,
  },
  'node/13255986857': {
    name: 'Parada Distrito Industrial',
    address: 'Avenida Lincoln Alves dos Santos · Distrito Industrial',
    lines: ['4601', '6404', '8201'],
    nextBus: '09:22',
    accessible: false,
  },
  'node/13255986858': {
    name: 'Parada Rua Eremita Dias',
    address: 'Rua Eremita Dias · Cidade Industrial',
    lines: ['4603', '5901', '6202'],
    nextBus: null,
    accessible: false,
  },
  'node/13255986859': {
    name: 'Parada Rua 43',
    address: 'Rua 43 · Cidade Industrial',
    lines: ['6404', '6604', '7103'],
    nextBus: '09:50',
    accessible: true,
  },
  'node/13281302431': {
    name: 'Parada Rua Carlos Gomes',
    address: 'Rua Carlos Gomes · Centro',
    lines: ['1501', '2201', '6604'],
    nextBus: '08:52',
    accessible: true,
  },
  'node/13281302432': {
    name: 'Parada Rua Camilo Prates',
    address: 'Rua Camilo Prates · Centro',
    lines: ['1601', '1702', '8801'],
    nextBus: '09:00',
    accessible: true,
  },
  'way/160635754': {
    name: 'Terminal Rodoviário Hildeberto Alves de Freitas',
    address: 'Praça Presidente Tancredo Neves · Canelas II',
    lines: ['1601', '5601', '5802', '6901'],
    nextBus: '08:45',
    accessible: true,
  },
  'way/548163981': {
    name: 'Plataforma lateral - Rodoviária',
    address: 'Avenida Donato Quintino · Canelas II',
    lines: ['2603', '3301', '5601'],
    nextBus: '09:08',
    accessible: true,
  },
};
