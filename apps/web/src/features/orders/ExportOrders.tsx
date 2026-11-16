// "Export CSV" on the orders list (docs/DEVELOPMENT.md §9.4, §11.4): every order matching the
// current search and filters, as a spreadsheet file. The API applies the business scope, escapes
// formula text and limits exports to 10 an hour; its message is shown if it refuses.
import { localDateOf } from '@ssom/shared';
import { useMutation } from '@tanstack/react-query';
import { ApiErrorMessage } from '../../components/ApiErrorMessage';
import { FormAlert, buttonClass } from '../../components/form';
import { useApi } from '../../lib/api-context';
import { saveFile } from '../../lib/save-file';
import { strings } from '../../lib/strings';
import { useBusinessTimeZone } from '../account/use-business';
import { orderExportApiPath } from './order-list-params';
import type { OrderListParams } from './order-list-params';

const s = strings.orders.list;

export function ExportOrders({ params, filtered }: { params: OrderListParams; filtered: boolean }) {
  const api = useApi();
  const timeZone = useBusinessTimeZone();
  const exportCsv = useMutation({
    mutationFn: () => api.download(orderExportApiPath(params)),
    onSuccess: (blob) => saveFile(blob, `orders-${localDateOf(new Date(), timeZone)}.csv`),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonClass.secondary}
          disabled={exportCsv.isPending}
          aria-busy={exportCsv.isPending || undefined}
          onClick={() => exportCsv.mutate()}
        >
          {exportCsv.isPending ? s.exporting : s.exportCsv}
        </button>
        <p className="text-sm text-slate-600">{filtered ? s.exportFiltered : s.exportAll}</p>
      </div>
      {exportCsv.isError && (
        <FormAlert tone="error">
          <p className="font-semibold">{s.exportFailed}</p>
          <ApiErrorMessage error={exportCsv.error} />
        </FormAlert>
      )}
      <p role="status" className="text-sm text-slate-700">
        {exportCsv.isSuccess ? s.exported : ''}
      </p>
    </div>
  );
}
