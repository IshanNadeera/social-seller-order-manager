import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Makes PrismaService injectable everywhere. Feature modules must still scope every query by businessId (§11.1). */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
