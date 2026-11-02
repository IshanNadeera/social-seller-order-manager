// The search box of a list (customers, products). Searches once typing pauses; Enter searches at once.
import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { TextField } from './form';

/** How long typing must pause before the list is searched (slow networks: fewer requests). */
export const SEARCH_DELAY_MS = 300;

/**
 * Searches as the seller types, once typing pauses; Enter searches at once. Follows the URL when it
 * changes from outside (Back, "Clear search").
 */
export function SearchBox({
  label,
  hint,
  value,
  onSearch,
}: {
  label: string;
  hint: string;
  value: string;
  onSearch: (q: string) => void;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  // The last search this box asked for, so the URL and the box don't fight.
  const lastSearched = useRef(value);
  // Act only when the settled text really changes, not on every render: after Back, the old
  // settled text must not be pushed into the URL again.
  const previousDebounced = useRef(debounced);

  useEffect(() => {
    if (value === lastSearched.current) return;
    lastSearched.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    if (debounced === previousDebounced.current) return;
    previousDebounced.current = debounced;
    if (debounced === lastSearched.current) return;
    lastSearched.current = debounced;
    onSearch(debounced);
  }, [debounced, onSearch]);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = text.trim();
        if (q === lastSearched.current) return;
        lastSearched.current = q;
        onSearch(q);
      }}
    >
      <TextField
        label={label}
        hint={hint}
        type="search"
        autoComplete="off"
        enterKeyHint="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </form>
  );
}
