import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cn } from "@/lib/utils"

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"

interface ButtonProps extends Omit<ButtonPrimitive.Props, "className"> {
    variant?: ButtonVariant
    size?: ButtonSize
    className?: string
}

// Sized defaults — the CSS in styles/ui.css handles the visual
// differences via [data-size] / [data-variant] attribute selectors, so
// the only thing this component does is set those attributes.
const sizeAttr: Record<ButtonSize, string | undefined> = {
    default: undefined,
    xs: "xs",
    sm: "sm",
    lg: "lg",
    icon: "icon",
    "icon-xs": "icon-xs",
    "icon-sm": "icon-sm",
    "icon-lg": "icon-lg",
}

// Styled button component — the base-ui primitive handles keyboard
// activation, focus management, and aria attributes. All visual
// styling is in styles/ui.css and keyed off [data-slot="button"] +
// [data-variant] / [data-size] attributes.
function Button({
    className,
    variant = "default",
    size = "default",
    ...props
}: ButtonProps) {
    return (
        <ButtonPrimitive
            data-slot="button"
            data-variant={variant}
            data-size={sizeAttr[size]}
            className={cn(className)}
            {...props}
        />
    )
}

export { Button }
export type { ButtonProps, ButtonVariant, ButtonSize }
