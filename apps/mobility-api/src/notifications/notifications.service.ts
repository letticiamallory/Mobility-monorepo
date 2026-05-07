import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class NotificationsService {
  private enabled = false;

  constructor() {
    const hasCredentials =
      !!process.env.FIREBASE_PROJECT_ID &&
      !!process.env.FIREBASE_CLIENT_EMAIL &&
      !!process.env.FIREBASE_PRIVATE_KEY;

    if (hasCredentials && !admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }

    this.enabled = hasCredentials;
  }

  async sendPush(token: string, title: string, body: string, data?: object) {
    if (!this.enabled) {
      return;
    }

    const payloadData = Object.fromEntries(
      Object.entries((data ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );

    await admin.messaging().send({
      token,
      notification: { title, body },
      data: payloadData,
      android: {
        notification: {
          channelId: 'mobility_alerts',
          priority: 'high',
        },
      },
    });
  }

  async sendRouteAlert(token: string, message: string) {
    await this.sendPush(token, 'Alerta de Rota', message, { type: 'route_alert' });
  }

  async sendWeatherAlert(token: string, condition: string) {
    await this.sendPush(
      token,
      'Alerta de Clima',
      `${condition} no seu trajeto`,
      { type: 'weather_alert' },
    );
  }
}
