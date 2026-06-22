import { clsx, type ClassValue } from "clsx"

// Conditionally join class name strings. ``clsx`` handles the common
// cases (falsy values, arrays, conditional objects). We don't need
// tailwind-merge anymore since we left the utility-class world — any
// class conflict is resolved at the CSS level by selector specificity.
export function cn(...inputs: ClassValue[]) {
    return clsx(inputs)
}
