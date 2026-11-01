import './load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';
import { parseEnv } from './common/env';
import { PinoNestLogger, createLogger } from './common/logging/logger';

async function bootstrap(): Promise<void> {
  // Fail fast: nothing starts until the environment is valid.
  const env = parseEnv(process.env);
  const logger = createLogger(env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bodyParser: false,
    bufferLogs: true, // start-up messages wait for the JSON logger below
  });
  app.useLogger(new PinoNestLogger(logger));
  configureApp(app, env, { logger });
  await app.listen(env.PORT);
  logger.info({ port: env.PORT }, `API listening under /${API_PREFIX}`);
}

bootstrap().catch((error: unknown) => {
  // The JSON logger may not exist yet (e.g. invalid environment), so use Nest's plain logger.
  Logger.error(error instanceof Error ? error.message : String(error), 'Bootstrap');
  process.exitCode = 1;
});
