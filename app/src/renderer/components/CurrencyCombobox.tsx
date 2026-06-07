import { useDeferredValue, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import type { Catalog, Currency } from '../types';
import { cn } from '../lib/utils';

type CurrencyComboboxProps = {
  id: string;
  label: string;
  value: string;
  catalog: Catalog | null;
  onChange: (value: string) => void;
};

function matchesCurrency(currency: Currency, query: string) {
  const tokens = query.toLowerCase().split(/\s+/g).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    currency.text,
    currency.apiId,
    currency.categoryLabel,
    currency.categoryApiId
  ].filter(Boolean).join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function selectedCurrency(catalog: Catalog | null, value: string) {
  return catalog?.currencies.find((item) => item.apiId === value) || null;
}

export function CurrencyCombobox({ id, label, value, catalog, onChange }: CurrencyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const selected = selectedCurrency(catalog, value);

  const groups = useMemo(() => {
    const next = [];
    let remaining = 80;
    for (const group of catalog?.categories || []) {
      if (remaining <= 0) break;
      const items = group.items.filter((item) => matchesCurrency(item, deferredQuery)).slice(0, remaining);
      if (!items.length) continue;
      next.push({ label: group.label, items });
      remaining -= items.length;
    }
    return next;
  }, [catalog, deferredQuery]);

  return (
    <div className="combo-field">
      <label htmlFor={id}>{label}</label>
      <button
        id={id}
        type="button"
        className="combo-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="combo-value">
          {selected?.iconUrl ? <img src={selected.iconUrl} alt="" /> : <span className="currency-dot" />}
          <span>
            <strong>{selected?.text || value || 'Choose currency'}</strong>
            <small>{selected?.apiId || value || '--'}</small>
          </span>
        </span>
        <ChevronsUpDown aria-hidden="true" size={16} />
      </button>

      {open ? (
        <div className="combo-popover" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
          <div className="combo-search">
            <Search aria-hidden="true" size={16} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, id, category"
            />
          </div>
          <div className="combo-list">
            {groups.length ? (
              groups.map((group) => (
                <div className="combo-group" key={group.label}>
                  <div className="combo-group-label">{group.label}</div>
                  {group.items.map((item) => (
                    <button
                      className={cn('combo-option', item.apiId === value && 'selected')}
                      key={item.apiId}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onChange(item.apiId);
                        setQuery('');
                        setOpen(false);
                      }}
                    >
                      {item.iconUrl ? <img src={item.iconUrl} alt="" /> : <span className="currency-dot" />}
                      <span>
                        <strong>{item.text}</strong>
                        <small>{item.apiId}</small>
                      </span>
                      {item.apiId === value ? <Check aria-hidden="true" size={16} /> : null}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="combo-empty">No currencies found.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
