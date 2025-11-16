/* eslint-disable react-refresh/only-export-components */

import React from "react";
import { VendorShipments } from "./VendorShipments";
import { VendorEdit } from "./VendorEdit";


function VendorEditRoute() {
  // ハッシュ変更でも再描画されるように（簡易）
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const onHash = () => force(v => v + 1);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // "#/vendor/shipments/edit?id=..." から id を取得
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const headerId = q.get("id") || "new";

  return (
    <VendorEdit
      headerId={headerId}
      onBack={() => { location.hash = "#/vendor/shipments"; }}
    />
  );
}

export const vendorRoutes = [
  { path: "/vendor/shipments",      element: <VendorShipments /> },
  { path: "/vendor/shipments/edit", element: <VendorEditRoute /> }, // ★ ラッパーを使う
];


// export const vendorRoutes = [
// { path: "/vendor/shipments", element: <VendorShipments /> },
// { path: "/vendor/shipments/edit", element: <VendorEdit /> },
// ];