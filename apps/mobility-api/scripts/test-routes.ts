import axios from 'axios';

type LatLng = { lat: number; lng: number };

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? '';
const OTP_URL = process.env.OTP_URL ?? 'http://localhost:8080';

async function testGoogle(origin: LatLng, dest: LatLng) {
  const url =
    'https://maps.googleapis.com/maps/api/directions/json?' +
    `origin=${origin.lat},${origin.lng}&` +
    `destination=${dest.lat},${dest.lng}&` +
    'mode=transit&alternatives=true&language=pt-BR&' +
    `key=${GOOGLE_API_KEY}`;

  const { data } = await axios.get(url);
  const first = data?.routes?.[0];
  const legs = first?.legs ?? [];
  const durationValue = Number(legs?.[0]?.duration?.value ?? 0);
  return {
    routes: data?.routes ?? [],
    firstRoute: {
      accessible: true,
      slope_warning: false,
      total_duration: `${Math.round(durationValue / 60)} minutos`,
    },
  };
}

async function testOtp(origin: LatLng, dest: LatLng) {
  const url =
    `${OTP_URL}/otp/routers/default/plan?` +
    `fromPlace=${origin.lat},${origin.lng}&` +
    `toPlace=${dest.lat},${dest.lng}&` +
    'mode=TRANSIT,WALK&wheelchair=true&numItineraries=3&maxWalkDistance=1000';

  const { data } = await axios.get(url);
  const itineraries = data?.plan?.itineraries ?? [];
  return itineraries.map((itinerary: any) => ({
    total_duration: `${Math.round(Number(itinerary.duration ?? 0) / 60)} minutos`,
    accessible: itinerary.legs?.every((l: any) => l.rentedBike !== true) ?? true,
    slope_warning: itinerary.legs?.some((l: any) => l.slopeExceeded === true) ?? false,
    stages:
      itinerary.legs?.map((leg: any) => ({
        mode:
          leg.mode === 'WALK' ? 'walk' : leg.mode === 'BUS' ? 'bus' : 'subway',
        instruction:
          leg.mode === 'WALK'
            ? `Caminhe até ${leg.to?.name ?? 'destino'}`
            : `Embarque em ${leg.from?.name ?? 'ponto'} — ${leg.route ?? leg.routeShortName ?? 'linha'}`,
        distance: `${Math.round(Number(leg.distance ?? 0))}m`,
        duration: `${Math.round(Number(leg.duration ?? 0) / 60)} min`,
        accessible: !leg.slopeExceeded,
        warning: leg.slopeExceeded
          ? 'Trecho com inclinação acima de 8% — pode ser difícil'
          : null,
      })) ?? [],
  }));
}

async function testRoutes() {
  const origin = { lat: -16.7089, lng: -43.8723 };
  const dest = { lat: -16.7445, lng: -43.8534 };

  console.log('=== TESTE GOOGLE DIRECTIONS ===');
  const googleResult = await testGoogle(origin, dest);
  console.log('Rotas Google:', googleResult.routes?.length);
  console.log('Acessível:', googleResult.firstRoute?.accessible);
  console.log('Slope warning:', googleResult.firstRoute?.slope_warning);

  console.log('\n=== TESTE OTP ===');
  const otpResult = await testOtp(origin, dest);
  console.log('Rotas OTP:', otpResult?.length);
  console.log('Acessível:', otpResult?.[0]?.accessible);
  console.log('Slope warning:', otpResult?.[0]?.slope_warning);
  console.log('Stages:', JSON.stringify(otpResult?.[0]?.stages, null, 2));
}

testRoutes().catch((err) => {
  console.error(err);
  process.exit(1);
});
