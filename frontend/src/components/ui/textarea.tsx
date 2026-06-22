import * as React from "react"

import { cn } from "@/lib/utils"

// Styled textarea component — all visual styling is in styles/ui.css
// keyed off [data-slot="textarea"].
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
    function Textarea({ className, ...props }, ref) {
        return (
            <textarea
                ref={ref}
                data-slot="textarea"
                className={cn(className)}
                {...props}
            />
        )
    }
)

export { Textarea }
