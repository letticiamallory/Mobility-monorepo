import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from =
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      'Mobility <onboarding@resend.dev>';
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY não configurada; log do código de verificação.');
      this.logger.log(`Verification code for ${email}: ${code}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.from,
        to: email,
        subject: 'Confirme seu email — Mobility',
        html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0057A8;">Verifique seu email</h2>
          <p>Use o código abaixo para confirmar seu cadastro:</p>
          <div style="background: #EBF3FF; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0057A8;">${code}</span>
          </div>
          <p style="color: #666;">O código expira em 15 minutos.</p>
        </div>
      `,
      });
    } catch (err) {
      this.logger.error(
        `Resend falhou para ${email}; cadastro já foi gravado — código no log abaixo.`,
        err instanceof Error ? err.stack : String(err),
      );
      this.logger.log(`Verification code for ${email} (fallback após erro Resend): ${code}`);
    }
  }
}
