// Product screens (docs/DEVELOPMENT.md §6.7).
export const productPaths = {
  list: '/products',
  new: '/products/new',
  edit: (id: string) => `/products/${encodeURIComponent(id)}`,
} as const;
