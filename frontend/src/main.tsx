import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import HistoryPage from "./HistoryPage"; // ← src/HistoryPage.tsx（拡張子 .tsx）

import "./index.css"; // あれば

const router = createBrowserRouter([
  { path: "/", element: <App /> },          // 既存の発注画面
  { path: "/history", element: <HistoryPage /> }, // 新規：バックオフィス履歴
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
