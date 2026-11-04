// Step 2 of the order form (docs/DEVELOPMENT.md §6.4): find an existing customer by name or phone,
// or quick-add one in a sheet. Walk-in sales may leave it empty.
import type { CustomerSummary } from '@ssom/shared';
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { TextField, buttonClass } from '../../components/form';
import { strings } from '../../lib/strings';
import { useCustomerSearch } from './api';
import { QuickCustomerSheet } from './QuickAddSheets';

const f = strings.orders.form.customer;

/** Enter in a search box picks nothing and must not save the whole order. */
export function keepEnterFromSubmitting(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') event.preventDefault();
}

export function CustomerPicker({
  customer,
  error,
  onChoose,
  onClear,
}: {
  customer: CustomerSummary | null;
  error?: string;
  onChoose: (customer: CustomerSummary) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const search = useCustomerSearch(customer === null ? text : '');

  if (customer !== null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <p className="font-medium">{f.chosen(customer.name)}</p>
          {customer.phone !== null && <p className="text-sm text-slate-600">{customer.phone}</p>}
        </div>
        <button type="button" className={buttonClass.quiet} onClick={onClear}>
          {f.change}
        </button>
      </div>
    );
  }

  const q = text.trim();
  const results = q === '' ? undefined : search.data?.items;
  return (
    <div className="space-y-2">
      <TextField
        type="search"
        label={f.search}
        hint={f.searchHint}
        autoComplete="off"
        value={text}
        error={error}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keepEnterFromSubmitting}
      />
      {search.isError && q !== '' && <p className="text-sm text-red-700">{f.searchFailed}</p>}
      {results !== undefined &&
        (results.length === 0 ? (
          <p role="status" className="text-sm text-slate-600">
            {f.noMatches(q)}
          </p>
        ) : (
          <ul
            aria-label={f.results}
            className="divide-y divide-slate-200 rounded-lg border border-slate-200"
          >
            {results.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700"
                  onClick={() => {
                    setText('');
                    onChoose(match);
                  }}
                >
                  <span className="font-medium">{match.name}</span>
                  {match.phone !== null && (
                    <span className="text-sm text-slate-600">{match.phone}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ))}
      <button type="button" className={buttonClass.secondary} onClick={() => setAdding(true)}>
        {f.add}
      </button>
      <QuickCustomerSheet
        open={adding}
        initialName={text}
        onClose={() => setAdding(false)}
        onCreated={(created) => {
          setAdding(false);
          setText('');
          onChoose(created);
        }}
      />
    </div>
  );
}
