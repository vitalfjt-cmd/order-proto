export const ID = {
  vendor: (s: string) => String(s ?? '').replace(/\D/g, '').padStart(6, '0'),
  item:   (s: string) => String(s ?? '').replace(/\D/g, '').padStart(6, '0'),
  store:  (s: string) => String(s ?? '').replace(/\D/g, '').padStart(4, '0'),
};
