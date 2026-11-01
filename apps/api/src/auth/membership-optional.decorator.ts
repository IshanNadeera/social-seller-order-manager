import { SetMetadata } from '@nestjs/common';

export const IS_MEMBERSHIP_OPTIONAL = 'ssom:isMembershipOptional';

/**
 * The route still needs a valid token and a non-disabled account, but not a business membership.
 * Only for GET /me and POST /onboarding (docs/DEVELOPMENT.md §11.2), which a signed-up user calls
 * before their business exists. On these routes `req.auth` is set only if a membership exists.
 */
export const AllowWithoutMembership = () => SetMetadata(IS_MEMBERSHIP_OPTIONAL, true);
