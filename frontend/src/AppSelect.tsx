import { useEffect, useId, useRef, useState } from "react";

export type AppSelectOption = {
  value: string;
  label: string;
  description?: string;
};

type AppSelectProps = {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function AppSelect({
  value,
  options,
  onChange,
  label,
  placeholder = "Select…",
  disabled = false,
  className
}: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`app-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className ?? ""}`.trim()}
    >
      {label && <span className="app-select-label">{label}</span>}
      <button
        type="button"
        className="app-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="app-select-value">
          {selected?.label ?? (value ? value : placeholder)}
        </span>
        <span className="app-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul id={listId} className="app-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`app-select-option ${isSelected ? "is-selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="app-select-option-label">{option.label}</span>
                  {option.description && (
                    <span className="app-select-option-desc">{option.description}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
