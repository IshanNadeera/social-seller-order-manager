import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'ssom:isPublic';

/**
 * Marks a route or controller as reachable without a Supabase access token.
 * Every other route requires one (AuthGuard is global). Use sparingly: today only GET /health (§9.1).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
