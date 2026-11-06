/**
 * SampCode brand (formerly ZAPX). The artwork lives in public/brand/ (originals and PNG exports in
 * docs/brand/). The mark is a still image so it stays put in the sidebar; the full animated logo is
 * shown on the sign-in page, in a light and a dark version that follow the colour scheme (CSS in
 * neon.css: `.sc-logo-light` / `.sc-logo-dark`).
 */
export const BRAND = { name: 'SampCode', tagline: 'Write. Run. Ship.', by: 'Sampledge' } as const;

/** The SampCode icon (two interlocking chevrons around a core). Decorative: pair it with the name. */
export function BrandMark({ size = 38, className }: { size?: number; className?: string }) {
  return (
    <img
      className={`sc-mark${className ? ` ${className}` : ''}`}
      src="/brand/sampcode-icon.svg"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** "SampCode" set in the brand style: "Samp" in the text colour, "Code" in the brand gradient. */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={`sc-word${className ? ` ${className}` : ''}`}>
      Samp<span className="sc-word-code">Code</span>
    </span>
  );
}

/** The full logo with tagline and "by Sampledge", animated, in the version that suits the scheme. */
export function BrandLogo({ width = 300 }: { width?: number }) {
  const height = Math.round((width * 78) / 287.2);
  return (
    <span className="sc-logo" role="img" aria-label="SampCode: Write. Run. Ship. By Sampledge">
      <img className="sc-logo-light" src="/brand/sampcode-logo-light.svg" alt="" width={width} height={height} draggable={false} />
      <img className="sc-logo-dark" src="/brand/sampcode-logo-dark.svg" alt="" width={width} height={height} draggable={false} />
    </span>
  );
}
