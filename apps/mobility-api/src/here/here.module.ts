import { Module } from '@nestjs/common';
import { HereController } from './here.controller';
import { HereService } from './here.service';

@Module({
  controllers: [HereController],
  providers: [HereService],
  exports: [HereService],
})
export class HereModule {}
