// Customer screens (docs/DEVELOPMENT.md §6.6).
export const customerPaths = {
  list: '/customers',
  new: '/customers/new',
  detail: (id: string) => `/customers/${encodeURIComponent(id)}`,
  edit: (id: string) => `/customers/${encodeURIComponent(id)}/edit`,
} as const;
