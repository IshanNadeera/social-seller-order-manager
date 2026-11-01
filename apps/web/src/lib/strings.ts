import type { SourceChannel } from '@ssom/shared';

// Every piece of user-facing text lives here, so Sinhala and Tamil can be added later
// without hunting through components (docs/DEVELOPMENT.md §6.9).
// Labels for shared codes are typed with Record<Code, string>, so a code added to
// @ssom/shared without a label here is a type error.

const sourceChannelLabels: Record<SourceChannel, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Phone call',
  WALK_IN: 'Walk-in',
  WEBSITE: 'Website',
  OTHER: 'Other',
};

export const strings = {
  appName: 'Social Seller Order Manager',
  dashboard: {
    title: 'Dashboard',
    empty: 'Your orders will show up here.',
  },
  notFound: {
    title: 'Page not found',
    body: 'We couldn’t find that page. It may have moved, or the link may be wrong.',
    backHome: 'Go to the dashboard',
  },
  sourceChannel: sourceChannelLabels,
} as const;
