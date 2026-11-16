// The period picker shared by the dashboard and the reports (docs/DEVELOPMENT.md §6.2): presets
// worked out from today on the business's clock, or two dates of the seller's choosing.
import { useState } from 'react';
import { SelectField, TextField } from '../../components/form';
import { strings } from '../../lib/strings';
import { RANGE_PRESETS, presetOf, presetRange } from './dashboard-range';
import type { DateRange, RangePreset } from './dashboard-range';

const s = strings.dashboard;

/** `problem` is the reason the chosen range can't be asked for (shown on the end date). */
export function PeriodPicker({
  range,
  today,
  problem,
  onChange,
}: {
  range: DateRange;
  today: string;
  problem: string | null;
  onChange: (range: DateRange) => void;
}) {
  const preset = presetOf(range, today);
  // "Choose dates" stays open while the seller types, even if the dates match a preset.
  const [choosing, setChoosing] = useState(preset === null);
  const value: RangePreset | 'custom' = choosing || preset === null ? 'custom' : preset;
  const p = s.period;

  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <legend className="px-1 font-semibold">{p.legend}</legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label={p.preset}
          value={value}
          onChange={(event) => {
            const next = event.target.value as RangePreset | 'custom';
            setChoosing(next === 'custom');
            if (next !== 'custom') onChange(presetRange(next, today));
          }}
        >
          {RANGE_PRESETS.map((key) => (
            <option key={key} value={key}>
              {p.presets[key]}
            </option>
          ))}
          <option value="custom">{p.presets.custom}</option>
        </SelectField>
        {value === 'custom' && (
          <>
            <TextField
              label={p.from}
              type="date"
              value={range.from}
              max={today}
              onChange={(event) => {
                if (event.target.value !== '') onChange({ ...range, from: event.target.value });
              }}
            />
            <TextField
              label={p.to}
              type="date"
              value={range.to}
              max={today}
              error={problem ?? undefined}
              onChange={(event) => {
                if (event.target.value !== '') onChange({ ...range, to: event.target.value });
              }}
            />
          </>
        )}
      </div>
    </fieldset>
  );
}
