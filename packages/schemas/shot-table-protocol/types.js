"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isShotTableRecord = void 0;
const isShotTableRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
exports.isShotTableRecord = isShotTableRecord;
