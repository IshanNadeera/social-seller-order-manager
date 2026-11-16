import { Module } from '@nestjs/common';
import { ExportLimit } from './export-limit';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/** CSV export of orders (§9.4, §11.4). */
@Module({
  controllers: [ExportsController],
  providers: [ExportsService, { provide: ExportLimit, useFactory: () => new ExportLimit() }],
})
export class ExportsModule {}
