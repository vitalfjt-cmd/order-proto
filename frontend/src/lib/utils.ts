// import { clsx, type ClassValue } from "clsx"
// import { twMerge } from "tailwind-merge"

// export function cn(...inputs: ClassValue[]) {
//   return twMerge(clsx(inputs))
// }

import { type ClassValue } from "clsx";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui が使うクラス結合ヘルパー */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
