import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Env } from './env';

/** Injection token for the validated environment: `constructor(@Inject(ENV) private readonly env: Env)`. */
export const ENV = Symbol('ENV');

/** Makes the environment validated in main.ts injectable everywhere. */
@Global()
@Module({})
export class EnvModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: EnvModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
