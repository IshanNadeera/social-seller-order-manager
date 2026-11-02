// Search text inside LIKE / ILIKE (docs/DEVELOPMENT.md §11.4).

/**
 * Makes text match literally inside LIKE / ILIKE, for Prisma's `contains` / `startsWith` /
 * `endsWith`. Prisma does NOT escape wildcards: it builds `'%' || value || '%'` as is (prisma-engines,
 * sql-query-builder filter/visitor.rs), so without this a search for "_" or "%" matches everything.
 * PostgreSQL's default escape character is the backslash.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
