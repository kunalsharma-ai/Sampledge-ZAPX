export interface ProgressMeterProps {
  label: string;
  value: number;
  max?: number;
  /** Shows "value / max" beside the label. */
  showValue?: boolean;
  /** Colours the bar by fullness: warn from 85%, bad at 100% (quota and plan meters). */
  thresholds?: boolean;
}

export function ProgressMeter({ label, value, max = 100, showValue = true, thresholds }: ProgressMeterProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tone = !thresholds ? 'accent' : pct >= 100 ? 'bad' : pct >= 85 ? 'warn' : 'accent';
  return (
    <div className="q-meter">
      <div className="q-meter-head">
        <span>{label}</span>
        {showValue ? (
          <span className="mono small">
            {value.toLocaleString()} / {max.toLocaleString()}
          </span>
        ) : null}
      </div>
      <div
        className={`q-meter-track q-meter-${tone}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
