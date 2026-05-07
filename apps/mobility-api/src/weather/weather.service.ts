import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WeatherService {
  async getWeatherForRoute(lat: number, lng: number) {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${process.env.OPENWEATHER_API_KEY}&lang=pt_br&units=metric`;
    const { data } = await axios.get(url);

    const rain = data.rain?.['1h'] ?? 0;
    return {
      condition: data.weather?.[0]?.description ?? null,
      temp: data.main?.temp ?? null,
      rain,
      alert: rain > 0 ? 'Chuva no trajeto — piso pode estar escorregadio' : null,
    };
  }
}
