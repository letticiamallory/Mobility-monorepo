import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class UberService {
  async getEstimate(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ) {
    const url = `https://api.uber.com/v1.2/estimates/price?start_latitude=${origin.lat}&start_longitude=${origin.lng}&end_latitude=${destination.lat}&end_longitude=${destination.lng}`;
    const { data } = await axios.get(url, {
      headers: {
        Authorization: `Token ${process.env.UBER_CLIENT_ID}`,
        Accept: 'application/json',
      },
    });

    return (
      data.prices?.map((price: any) => ({
        product: price.display_name,
        estimate: price.estimate,
        duration: price.duration,
        accessible: String(price.display_name)
          .toLowerCase()
          .includes('access'),
      })) ?? []
    );
  }

  getDeepLink(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ) {
    return `uber://?action=setPickup&pickup[latitude]=${origin.lat}&pickup[longitude]=${origin.lng}&dropoff[latitude]=${destination.lat}&dropoff[longitude]=${destination.lng}`;
  }
}
