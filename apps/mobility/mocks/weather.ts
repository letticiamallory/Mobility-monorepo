export const USE_MOCK_DATA = true;

export type WeatherCondition = 'clear' | 'rain' | 'heavy_rain' | 'cloudy' | 'storm';

export interface MockWeather {
  condition: WeatherCondition;
  description: string;
  temp: number;
  rain: number; // mm na última hora
  alert: string | null;
  icon: string; // MaterialCommunityIcons name
  color: string;
}

export const MOCK_WEATHER: Record<WeatherCondition, MockWeather> = {
  clear: {
    condition: 'clear',
    description: 'Céu limpo',
    temp: 28,
    rain: 0,
    alert: null,
    icon: 'weather-sunny',
    color: '#F59E0B',
  },
  cloudy: {
    condition: 'cloudy',
    description: 'Nublado',
    temp: 24,
    rain: 0,
    alert: null,
    icon: 'weather-cloudy',
    color: '#999999',
  },
  rain: {
    condition: 'rain',
    description: 'Chuva leve',
    temp: 21,
    rain: 2.5,
    alert: 'Chuva leve no trajeto — piso pode estar escorregadio',
    icon: 'weather-rainy',
    color: '#F59E0B',
  },
  heavy_rain: {
    condition: 'heavy_rain',
    description: 'Chuva forte',
    temp: 19,
    rain: 8,
    alert: 'Chuva forte no trajeto — superfícies escorregadias e visibilidade reduzida',
    icon: 'weather-pouring',
    color: '#EF4444',
  },
  storm: {
    condition: 'storm',
    description: 'Tempestade',
    temp: 17,
    rain: 15,
    alert: 'Tempestade no trajeto — evite sair se possível',
    icon: 'weather-lightning-rainy',
    color: '#EF4444',
  },
};

// Troque aqui para simular diferentes condições climáticas durante os testes
export const ACTIVE_MOCK_WEATHER: MockWeather = MOCK_WEATHER['heavy_rain'];
