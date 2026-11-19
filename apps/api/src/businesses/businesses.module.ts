import { Module } from '@nestjs/common';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

/** The business profile (§6.8, §9.1). */
@Module({
  controllers: [BusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
