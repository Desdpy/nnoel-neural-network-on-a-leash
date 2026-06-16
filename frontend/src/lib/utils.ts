import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Utility for conditionally joining Tailwind class names, with proper
// handling of conflicting utilities via tailwind-merge
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
