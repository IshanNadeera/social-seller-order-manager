// Every piece of user-facing text lives here, so Sinhala and Tamil can be added later
// without hunting through components (docs/DEVELOPMENT.md §6.9).
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
} as const;
