import './load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import { parseEnv } from './common/env';

async function bootstrap(): Promise<void> {
  // Fail fast: nothing starts until the environment is valid.
  const env = parseEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bodyParser: false,
  });
  configureApp(app, env);
  await app.listen(env.PORT);
  Logger.log(`API listening on port ${env.PORT} under /${API_PREFIX}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), 'Bootstrap');
  process.exitCode = 1;
});
