// frontend/src/main.tsx
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { StrictMode } from "react";
import App from "./App";
import "./index.css";


const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/history", element: <App /> },
]);



ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
