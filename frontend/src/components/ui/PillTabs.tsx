import React, { useCallback, useEffect, useRef } from 'react';

export type PillOption = { value: string; label: string };

interface PillTabsProps {
  options: PillOption[];
  value: string;
  onChange: (v: string) => void;
}

export const PillTabs: React.FC<PillTabsProps> = ({ options, value, onChange }) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    refs.current = refs.current.slice(0, options.length);
  }, [options.length]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      if (e.key === 'ArrowRight') {
        const next = (idx + 1) % options.length;
        refs.current[next]?.focus();
        onChange(options[next].value);
      } else if (e.key === 'ArrowLeft') {
        const prev = (idx - 1 + options.length) % options.length;
        refs.current[prev]?.focus();
        onChange(options[prev].value);
      }
    },
    [options, onChange]
  );

  return (
    <div role="tablist" aria-label="Mode" className="inline-flex gap-2">
      {options.map((opt, i) => {
        const selected = opt.value === value;
        const classes = [
          'h-10 rounded-full px-4 text-sm font-medium transition duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
          selected
            ? 'btn-gradient text-white premium-shadow elevated transform hover:-translate-y-1'
            : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={selected}
            ref={(el) => (refs.current[i] = el)}
            onKeyDown={(e) => handleKey(e, i)}
            onClick={() => onChange(opt.value)}
            className={classes}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default PillTabs;
