// "All UI strings kept in one file" (docs/DEVELOPMENT.md §6.9): fails if a component contains
// user-facing text written inline instead of coming from src/lib/strings.ts, so Sinhala and Tamil
// can be added later by translating one file. Uses the TypeScript parser, not a regex, so generics
// and comparisons in code are never mistaken for text.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Every component file (tests excluded), as source text. */
const sources = import.meta.glob<string>(['/src/**/*.tsx', '!/src/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Props that carry text people read or hear. */
const TEXT_PROPS = new Set([
  'aria-label',
  'aria-description',
  'alt',
  'title',
  'placeholder',
  'label',
  'hint',
  'message',
  'pendingLabel',
]);

/** Any letter in any script. */
const HAS_LETTER = /\p{L}/u;

export function findInlineText(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const where = (node: ts.Node) =>
    `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      found.push(`${where(node)} text "${node.text.trim()}"`);
    }
    if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(file))) {
      const value = node.initializer;
      const literal =
        value && ts.isStringLiteral(value)
          ? value
          : value &&
              ts.isJsxExpression(value) &&
              value.expression &&
              ts.isStringLiteralLike(value.expression)
            ? value.expression
            : undefined;
      if (literal && HAS_LETTER.test(literal.text)) {
        found.push(`${where(node)} ${node.name.getText(file)}="${literal.text}"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('UI strings live in src/lib/strings.ts', () => {
  it('finds the component files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it('has no inline user-facing text in any component', () => {
    const problems = Object.entries(sources).flatMap(([name, source]) =>
      findInlineText(name, source),
    );
    expect(problems).toEqual([]);
  });

  it('catches inline text and text props, but not code', () => {
    const sample = `
      const a = useState<Map<string, number> | null>(null);
      const ok = count < limit && limit > 0;
      export const X = () => (
        <div className="p-4 text-slate-600" aria-hidden="true">
          <h1>Orders</h1>
          <p>{strings.dashboard.empty}</p>
          <input aria-label="Search" placeholder={'Type here'} type="email" />
          <TextField label={strings.auth.fields.email} hint="At least 8" />
          {' '}·{' '}
        </div>
      );`;
    expect(
      findInlineText('sample.tsx', sample).map((problem) =>
        problem.replace(/^sample\.tsx:\d+ /, ''),
      ),
    ).toEqual([
      'text "Orders"',
      'aria-label="Search"',
      'placeholder="Type here"',
      'hint="At least 8"',
    ]);
  });
});
