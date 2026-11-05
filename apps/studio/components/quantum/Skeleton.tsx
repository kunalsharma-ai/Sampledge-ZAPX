/** Loading placeholder. Decorative: pair it with a visible or screen-reader "Loading" message. */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}) {
  return <span className="q-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}
