/* Presentation only: retain full numeric precision in calculations and exports. */
const fixedTwo = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  // Values that round to zero should not display a misleading minus sign.
  return fixedTwo.format(Math.abs(value) < .005 ? 0 : value);
}
