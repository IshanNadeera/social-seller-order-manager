// The order page's copyable customer messages (docs/DEVELOPMENT.md §2.1, §6.5): read-only text
// filled from the order, each with a Copy button. Nothing is sent from the app; if the browser
// won't copy, the text is selected so the seller can copy it by hand.
import type { OrderDetail } from '@ssom/shared';
import { useRef, useState } from 'react';
import { TextAreaField, buttonClass } from '../../components/form';
import { strings } from '../../lib/strings';
import { useBusinessCurrency, useBusinessName } from '../account/use-business';
import { messageTemplates } from './message-templates';
import type { MessageTemplate, MessageTemplateId } from './message-templates';

const m = strings.orders.messages;

export function MessageTemplates({ order }: { order: OrderDetail }) {
  const currency = useBusinessCurrency();
  const businessName = useBusinessName();
  const templates = messageTemplates(order, { businessName, currency });
  const [copied, setCopied] = useState<{ id: MessageTemplateId; ok: boolean } | null>(null);

  if (templates.length === 0) return <p className="text-slate-600">{m.none}</p>;

  const current = templates.find((template) => template.id === copied?.id);
  return (
    <div className="space-y-4">
      <p className="text-slate-700">{m.intro}</p>
      {templates.map((template) => (
        <Message
          key={template.id}
          template={template}
          copied={copied?.id === template.id && copied.ok}
          onCopied={(ok) => setCopied({ id: template.id, ok })}
        />
      ))}
      <p role="status" className="text-sm text-slate-700">
        {copied !== null && current !== undefined
          ? copied.ok
            ? m.copiedStatus(current.title)
            : m.copyFailed
          : ''}
      </p>
    </div>
  );
}

function Message({
  template,
  copied,
  onCopied,
}: {
  template: MessageTemplate;
  copied: boolean;
  onCopied: (ok: boolean) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const copy = async () => {
    try {
      // Only the browser's clipboard: no message leaves the app.
      await navigator.clipboard.writeText(template.text);
      onCopied(true);
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      onCopied(false);
    }
  };

  return (
    <div className="space-y-2">
      <TextAreaField
        ref={textRef}
        label={template.title}
        readOnly
        value={template.text}
        rows={Math.min(12, template.text.split('\n').length + 1)}
        className="bg-slate-50 font-normal"
      />
      <button
        type="button"
        className={buttonClass.secondary}
        aria-label={m.copyLabel(template.title)}
        onClick={() => void copy()}
      >
        {copied ? m.copied : m.copy}
      </button>
    </div>
  );
}
