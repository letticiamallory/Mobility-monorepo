import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Line } from './line.entity';
import { LinesController } from './lines.controller';
import { LinesService } from './lines.service';

@Module({
  imports: [TypeOrmModule.forFeature([Line])],
  controllers: [LinesController],
  providers: [LinesService],
})
export class LinesModule {}
