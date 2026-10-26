import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { hexToHSLA, hslaToHex } from "@excalidraw/common";

import { t } from "../../i18n";

import "./HSLASliders.scss";

interface HSLASlidersProps {
  color: string | null;
  onChange: (color: string) => void;
  /** 滑块拖动中的实时预览（不进撤销栈）；未提供时退回 onChange */
  onPreview?: (color: string) => void;
  /** 滑块拖动结束（松手 / 键盘抬起）时触发，携带松手时的最终颜色；用于提交撤销记录 */
  onCommit?: (color: string) => void;
}

/** 色相滑块的彩虹渐变背景 */
export const HUE_GRADIENT =
  "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)";

/** HSLA 单行滑块组件，供颜色选择器和图片滤镜复用 */
export const HSLASliderRow = ({
  label,
  value,
  min,
  max,
  step,
  bg,
  isAlpha,
  disabled,
  ariaLabel,
  onChange,
  onPreview,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  bg: string;
  isAlpha?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: number) => void;
  /** 拖动中的实时预览；未提供时退回 onChange */
  onPreview?: (value: number) => void;
  /** 拖动结束（pointerup / 方向键抬起）时触发，用于提交一次完整的撤销记录 */
  onCommit?: (value: number) => void;
}) => (
  <div className="hsla-slider-row">
    <label className="hsla-slider-label">{label}</label>
    <div
      className={clsx(
        "hsla-slider-track",
        isAlpha && "hsla-slider-track--alpha",
      )}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          // 拖动 / 键盘调节的实时变化走预览通道（不进撤销栈），离散操作退回 onChange
          if (onPreview) {
            onPreview(v);
          } else {
            onChange(v);
          }
        }}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => {
          // 方向键调节后松开时提交一次撤销记录
          if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") {
            onCommit?.(Number((e.target as HTMLInputElement).value));
          }
        }}
        onBlur={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        className="hsla-slider-input"
        style={{ background: bg } as React.CSSProperties}
        disabled={disabled}
        aria-label={ariaLabel}
      />
    </div>
    <span className="hsla-slider-value">{value}</span>
  </div>
);

export const HSLASliders = ({
  color,
  onChange,
  onPreview,
  onCommit,
}: HSLASlidersProps) => {
  /** HSLA 四维本地状态，h: 0-360, s/l/a: 0-100 */
  const [hsla, setHSLA] = useState({ h: 0, s: 100, l: 50, a: 100 });

  /**
   * 防回传标记：
   * 拖滑块 → handleChange 写入 hex → 父级重新传入 color → useEffect 触发。
   * 如果是由自身触发的颜色变更，跳过 hex→HSLA 解析，避免 tinycolor 往返精度漂移。
   */
  const isInternalRef = useRef(false);

  /** 外部颜色变更时同步本地 HSLA（非内部触发的） */
  useEffect(() => {
    if (isInternalRef.current) {
      isInternalRef.current = false;
      return;
    }
    if (!color || color === "transparent") {
      return;
    }
    const parsed = hexToHSLA(color);
    setHSLA({
      h: Math.round(parsed.h),
      s: Math.round(parsed.s),
      l: Math.round(parsed.l),
      a: Math.round(parsed.a * 100),
    });
  }, [color]);

  /** HSLA → hex，a 为 0-100 */
  const buildHex = (h: number, s: number, l: number, a: number) =>
    hslaToHex(h, s, l, a / 100);

  /** 统一处理四维变更：更新本地状态 + 通知父级。isPreview 时只走预览通道 */
  const handleChange = (
    partial: Partial<typeof hsla>,
    isPreview = false,
  ) => {
    const next = { ...hsla, ...partial };
    isInternalRef.current = true;
    setHSLA(next);
    const color = buildHex(next.h, next.s, next.l, next.a);
    if (isPreview && onPreview) {
      onPreview(color);
    } else {
      onChange(color);
    }
  };

  // 滑块的动态渐变背景
  const satGradient = `linear-gradient(to right, hsl(${hsla.h}, 0%, 50%), hsl(${hsla.h}, 100%, 50%))`;
  const currentRGB = buildHex(hsla.h, hsla.s, hsla.l, 100);
  const alphaGradient = `linear-gradient(to right, transparent, ${currentRGB})`;

  /** 当前无颜色或选择了调色板中的"transparent"时禁用滑块 */
  const isDisabled = !color || color === "transparent";

  /** 滑块配置：H/S/L/A 四维统一数据结构 */
  const sliders = [
    {
      label: "H",
      value: hsla.h,
      min: 0,
      max: 360,
      step: 1,
      bg: HUE_GRADIENT,
      aria: t("colorPicker.hue"),
      alpha: false,
    },
    {
      label: "S",
      value: hsla.s,
      min: 0,
      max: 100,
      step: 1,
      bg: satGradient,
      aria: t("colorPicker.saturation"),
      alpha: false,
    },
    {
      label: "L",
      value: hsla.l,
      min: 0,
      max: 100,
      step: 1,
      bg: "linear-gradient(to right, #000, #fff)",
      aria: t("colorPicker.lightness"),
      alpha: false,
    },
    {
      label: "A",
      value: hsla.a,
      min: 0,
      max: 100,
      step: 1,
      bg: alphaGradient,
      aria: t("colorPicker.alpha"),
      alpha: true,
    },
  ];

  return (
    <div className="hsla-sliders">
      {sliders.map(({ label, value, min, max, step, bg, aria, alpha }) => (
        <HSLASliderRow
          key={label}
          label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          bg={bg}
          isAlpha={alpha}
          disabled={isDisabled}
          ariaLabel={aria}
          onChange={(v) =>
            handleChange({
              [label.toLowerCase() as keyof typeof hsla]: v,
            } as Partial<typeof hsla>)
          }
          onPreview={
            onPreview
              ? (v) =>
                  handleChange(
                    {
                      [label.toLowerCase() as keyof typeof hsla]: v,
                    } as Partial<typeof hsla>,
                    true,
                  )
              : undefined
          }
          onCommit={
            onCommit
              ? () => onCommit(buildHex(hsla.h, hsla.s, hsla.l, hsla.a))
              : undefined
          }
        />
      ))}
    </div>
  );
};
