"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ID = void 0;
exports.ID = {
    vendor: (s) => String(s ?? '').replace(/\D/g, '').padStart(6, '0'),
    item: (s) => String(s ?? '').replace(/\D/g, '').padStart(6, '0'),
    store: (s) => String(s ?? '').replace(/\D/g, '').padStart(4, '0'),
};
