import './load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import { readBootstrapConfig } from './common/bootstrap-config';

async function bootstrap(): Promise<void> {
  const config = readBootstrapConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app, config);
  await app.listen(config.port);
  Logger.log(`API listening on port ${config.port} under /${API_PREFIX}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), 'Bootstrap');
  process.exitCode = 1;
});
