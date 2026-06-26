import { useEffect, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import "./StrokeWidthInput.scss";

interface StrokeWidthInputProps {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 100;

export const StrokeWidthInput = ({
  value,
  onChange,
  disabled = false,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
}: StrokeWidthInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");
  const lastValidValueRef = useRef<number>(value ?? min);

  useEffect(() => {
    if (value !== null) {
      setInputValue(value.toString());
      lastValidValueRef.current = value;
    } else {
      setInputValue("");
    }
  }, [value]);

  const commitValue = (rawValue: string) => {
    const parsed = parseInt(rawValue, 10);

    if (isNaN(parsed)) {
      setInputValue(lastValidValueRef.current.toString());
      return;
    }

    const clamped = Math.min(max, Math.max(min, parsed));
    setInputValue(clamped.toString());
    lastValidValueRef.current = clamped;
    onChange(clamped);
  };

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    if (disabled || value === null) {
      return;
    }

    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    const newValue = Math.min(max, Math.max(min, value + delta));
    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || value === null) {
      return;
    }

    if (e.key === KEYS.ENTER) {
      commitValue(inputValue);
      inputRef.current?.blur();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newValue = Math.min(max, value + 1);
      onChange(newValue);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const newValue = Math.max(min, value - 1);
      onChange(newValue);
    } else if (e.key === KEYS.ESCAPE) {
      setInputValue(lastValidValueRef.current.toString());
      inputRef.current?.blur();
    }
  };

  const handleBlur = () => {
    if (disabled || value === null) {
      return;
    }
    commitValue(inputValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (newValue === "" || /^\d*$/.test(newValue)) {
      setInputValue(newValue);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="stroke-width-input"
      value={value === null ? "Mixed" : inputValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onWheel={handleWheel}
      disabled={disabled || value === null}
      readOnly={value === null}
      autoComplete="off"
      spellCheck={false}
    />
  );
};
