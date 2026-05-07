export type Station = {
  id: string;
  type: 'bus' | 'subway';
  name: string;
  address: string;
  distance: string;
  distanceNum: number;
  accessible: boolean;
  lines: string[];
  nextBus: string | null;
  lat: number;
  lng: number;
};

export const MOCK_STATIONS: Station[] = [
  {
    id: '1',
    type: 'bus',
    name: 'Terminal Central',
    address: 'Praça Dr. Carlos Versiani, Centro',
    distance: '200m',
    distanceNum: 200,
    accessible: true,
    lines: ['1501', '1701', '2201', '6201'],
    nextBus: '09:15',
    lat: -16.729,
    lng: -43.8617,
  },
  {
    id: '2',
    type: 'bus',
    name: 'Parada Ibituruna',
    address: 'Av. Deputado Esteves Rodrigues, Ibituruna',
    distance: '1,2km',
    distanceNum: 1200,
    accessible: true,
    lines: ['5801', '6901'],
    nextBus: '09:22',
    lat: -16.7089,
    lng: -43.8723,
  },
  {
    id: '3',
    type: 'bus',
    name: 'Parada Montes Claros Shopping',
    address: 'Av. Donato Quintino, Cidade Nova',
    distance: '2,1km',
    distanceNum: 2100,
    accessible: true,
    lines: ['2603', '3301'],
    nextBus: '09:30',
    lat: -16.7445,
    lng: -43.8534,
  },
  {
    id: '4',
    type: 'bus',
    name: 'Parada Unimontes',
    address: 'Av. Rui Braga, Vila Mauricéia',
    distance: '3,4km',
    distanceNum: 3400,
    accessible: true,
    lines: ['6901', '7101'],
    nextBus: '09:18',
    lat: -16.7012,
    lng: -43.8456,
  },
  {
    id: '5',
    type: 'bus',
    name: 'Parada Hospital Aroldo Tourinho',
    address: 'Av. Silvio Menicucci, Funcionários',
    distance: '1,8km',
    distanceNum: 1800,
    accessible: true,
    lines: ['4601', '5801'],
    nextBus: '09:45',
    lat: -16.7234,
    lng: -43.8789,
  },
  {
    id: '6',
    type: 'bus',
    name: 'Parada Parque Cândido Portinari',
    address: 'Av. Osmane Barbosa, JK',
    distance: '2,5km',
    distanceNum: 2500,
    accessible: false,
    lines: ['2201', '3301'],
    nextBus: null,
    lat: -16.7167,
    lng: -43.8345,
  },
  {
    id: '7',
    type: 'bus',
    name: 'Parada Rodoviária',
    address: 'Praça Presidente Tancredo Neves, Canelas',
    distance: '3,0km',
    distanceNum: 3000,
    accessible: true,
    lines: ['1601', '5601'],
    nextBus: '09:50',
    lat: -16.7389,
    lng: -43.8678,
  },
  {
    id: '8',
    type: 'bus',
    name: 'Parada UFMG',
    address: 'Av. Universitária, Universitário',
    distance: '4,2km',
    distanceNum: 4200,
    accessible: true,
    lines: ['2201', '5101'],
    nextBus: '10:00',
    lat: -16.6978,
    lng: -43.8512,
  },
];
