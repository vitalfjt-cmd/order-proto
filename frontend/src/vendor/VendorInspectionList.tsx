
import React from "react";
import { InspectionList } from "../inspection/InspectionList";
import type { OwnerType } from "../inspection/inspectionApi";

// DC 用の検品一覧ラッパー
// - ownerType は常に "DC"
// - ownerId に DC のID（例: "DC01"）を渡す想定
type Props = {
  dcId: string;                         // 例: "DC01"
  onEdit: (headerId: string) => void;   // 詳細画面への遷移など
  onBack?: () => void;
};

export function VendorInspectionList({ dcId, onEdit, onBack }: Props) {
  return (
    <InspectionList
      ownerType={"DC" as OwnerType}
      ownerId={dcId}
      onEdit={onEdit}
      onBack={onBack}
    />
  );
}
