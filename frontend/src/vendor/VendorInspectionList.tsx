// frontend/src/vendor/VendorInspectionList.tsx
import { Suspense, lazy } from "react";
import type { Props as InspectionListProps } from "../inspection/InspectionList";

const InspectionList = lazy(async () => {
  const mod = await import("../inspection/InspectionList");
  return { default: mod.InspectionList }; // ★ named export を lazy の default に変換
});

type Props = {
  dcId: string;
  onEdit: InspectionListProps["onEdit"];
  onBack?: InspectionListProps["onBack"];
};

export function VendorInspectionList({ dcId, onEdit, onBack }: Props) {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">読み込み中...</div>}>
      <InspectionList ownerType="DC" ownerId={dcId} onEdit={onEdit} onBack={onBack} />
    </Suspense>
  );
}
