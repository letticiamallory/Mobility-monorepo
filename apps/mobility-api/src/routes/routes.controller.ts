import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  Logger,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { RoutesService } from './routes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckRouteDto } from './dto/check-route.dto';

@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RoutesController {
  private readonly logger = new Logger(RoutesController.name);

  constructor(private routesService: RoutesService) {}

  @Post('check')
  @HttpCode(200)
  async checkRoute(
    @Req() req: Request & { user: { id: number } },
    @Body() body: CheckRouteDto,
  ) {
    if (body.user_id !== req.user.id) {
      throw new ForbiddenException(
        'O user_id informado não corresponde ao usuário autenticado.',
      );
    }
    this.logger.log(
      `[checkRoute] request body: ${JSON.stringify({
        user_id: body.user_id,
        origin: body.origin,
        destination: body.destination,
        transport_type: body.transport_type,
        accompanied: body.accompanied ?? null,
        time_filter: body.time_filter ?? null,
        time_value: body.time_value ?? null,
        route_preference: body.route_preference ?? null,
        route_preferences: body.route_preferences ?? null,
      })}`,
    );
    return this.routesService.checkRoute(
      body.user_id,
      body.origin,
      body.destination,
      body.transport_type,
      body.accompanied,
      body.time_filter,
      body.time_value,
      body.route_preference,
      body.route_preferences,
      body.origin_title,
      body.destination_title,
      body.origin_address,
      body.destination_address,
      body.origin_latitude,
      body.origin_longitude,
      body.destination_latitude,
      body.destination_longitude,
    );
  }

  /** Rotas literais antes de `:id`, senão `GET /routes/history/1` casa com `:id = "history"` e quebra. */
  @Get('history/:user_id')
  async findHistoryByUserId(@Param('user_id', ParseIntPipe) user_id: number) {
    return this.routesService.findHistoryByUserId(user_id);
  }

  @Get(':id')
  async getRouteById(@Param('id', ParseIntPipe) id: number) {
    return this.routesService.getRouteById(id);
  }
}
