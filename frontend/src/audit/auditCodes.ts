// frontend/src/audit/auditCodes.ts
import type { AuditEventType } from "../auditlog";

export const AUDIT_EVENT_TYPES: AuditEventType[] = [
  "shipment.confirm",
  "shipment.unconfirm",
  "shipment.save",
  "inspection.confirm",
  "inspection.unconfirm",
  "inspection.save",
  "inspection.audit",
];

export const AUDIT_EVENT_TYPE_LABEL: Record<AuditEventType, string> = {
  "shipment.confirm": "出荷確定",
  "shipment.unconfirm": "出荷確定取消",
  "shipment.save": "出荷保存",
  "inspection.confirm": "検収確定",
  "inspection.unconfirm": "検収取消",
  "inspection.save": "検品保存",
  "inspection.audit": "検品監査",
};

export function isAuditEventType(t: string): t is AuditEventType {
  return t in AUDIT_EVENT_TYPE_LABEL;
}
