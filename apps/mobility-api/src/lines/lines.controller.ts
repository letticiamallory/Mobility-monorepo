import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Line } from './line.entity';
import { LinesService } from './lines.service';

@Controller('lines')
export class LinesController {
  constructor(private readonly linesService: LinesService) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('region') region?: string,
  ): Promise<Line[]> {
    return this.linesService.findAll(search, region);
  }

  @Get(':id')
  async findById(@Param('id', ParseIntPipe) id: number): Promise<Line> {
    return this.linesService.findById(id);
  }

  /**
   * Popular/atualizar linhas: Montes Claros (onibusmoc), DF (brasiliamobilidade.com.br),
   * São Paulo (GTFS oficial SPTrans; opcional `SPTRANS_GTFS_URL` para espelho).
   * - Em produção: defina `LINES_SEED_SECRET` e envie header `x-lines-seed-secret`.
   * - Em dev (`NODE_ENV` ≠ production): permitido sem segredo, a menos que `LINES_SEED_SECRET` esteja definido.
   * O app mobile só chama `GET /lines`; sem rodar este POST o banco pode ficar sem `schedules`.
   */
  @Post('seed')
  async seedFromWeb(@Headers('x-lines-seed-secret') seedSecret?: string) {
    const expected = process.env.LINES_SEED_SECRET?.trim();
    const isProd = process.env.NODE_ENV === 'production';
    if (expected) {
      if (seedSecret !== expected) {
        throw new UnauthorizedException('Header x-lines-seed-secret inválido ou ausente.');
      }
    } else if (isProd) {
      throw new UnauthorizedException(
        'Em produção configure LINES_SEED_SECRET e envie x-lines-seed-secret para /lines/seed.',
      );
    }
    return this.linesService.seedFromWeb();
  }
}
