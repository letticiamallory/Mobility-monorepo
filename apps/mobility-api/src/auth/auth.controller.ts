import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleAuthDto } from './google-auth.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto): Promise<{
    access_token: string;
    user_id: number;
    name: string;
  }> {
    return this.authService.login(body.email, body.password);
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body.email, body.code);
  }

  @Post('resend-verification')
  @HttpCode(200)
  async resendVerification(@Body() body: ForgotPasswordDto) {
    return this.authService.resendVerificationEmail(body.email);
  }

  @Post('google')
  @HttpCode(200)
  async googleLogin(@Body() body: GoogleAuthDto): Promise<{
    access_token: string;
    user_id: number;
    name: string;
  }> {
    return this.authService.loginWithGoogle(body);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<{
    message: string;
    resend_after_seconds: number;
  }> {
    return this.authService.forgotPassword(body.email);
  }

  @Post('verify-reset-code')
  async verifyResetCode(
    @Body() body: VerifyResetCodeDto,
  ): Promise<{ reset_token: string; expires_in_seconds: number }> {
    return this.authService.verifyResetCode(body.email, body.code);
  }

  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto): Promise<{ message: string }> {
    return this.authService.resetPassword(
      body.email,
      body.reset_token,
      body.new_password,
      body.confirm_password,
    );
  }
}
