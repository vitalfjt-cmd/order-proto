export const ymd = (d: Date | string) => {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const z = (n: number) => String(n).padStart(2,'0');
  return `${dt.getFullYear()}-${z(dt.getMonth()+1)}-${z(dt.getDate())}`;
};
