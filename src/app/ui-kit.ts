'use client'

/**
 * Client-boundary re-exports of @gears-frontx/ui-kit (IDEA-049).
 *
 * The kit ships no 'use client' banner of its own, and most of its
 * components call hooks (Button and every Base UI-backed component do;
 * even Badge uses Base UI's useRender), so a server component importing
 * them straight from the package would crash at render. Importing through
 * this module makes them client components app-wide — server and client
 * components alike import from '@/app/ui-kit', never from
 * '@gears-frontx/ui-kit' directly, so there is exactly one convention to
 * remember. Hook-free components (Card, Table, Skeleton) would work in
 * server components directly, but they ride the same wrapper rather than
 * earning a second import path for the few bytes it would save.
 *
 * Only components IDEA-048's audit found real replacement sites for are
 * re-exported. Each component is its own dist chunk (JS + CSS), so leaving
 * one out keeps its chunks out of the client bundle entirely, and adding
 * it later is a one-line change here.
 */

export {
  Badge,
  type BadgeProps,
  Button,
  type ButtonProps,
  Card,
  type CardProps,
  CardAction,
  type CardActionProps,
  CardContent,
  type CardContentProps,
  CardDescription,
  type CardDescriptionProps,
  CardFooter,
  type CardFooterProps,
  CardHeader,
  type CardHeaderProps,
  CardTitle,
  type CardTitleProps,
  DropdownMenu,
  type DropdownMenuProps,
  DropdownMenuContent,
  type DropdownMenuContentProps,
  DropdownMenuItem,
  type DropdownMenuItemProps,
  DropdownMenuLabel,
  type DropdownMenuLabelProps,
  DropdownMenuSeparator,
  type DropdownMenuSeparatorProps,
  DropdownMenuTrigger,
  type DropdownMenuTriggerProps,
  Field,
  type FieldProps,
  FieldDescription,
  type FieldDescriptionProps,
  FieldError,
  type FieldErrorProps,
  FieldLabel,
  type FieldLabelProps,
  Input,
  type InputProps,
  Label,
  type LabelProps,
  Select,
  type SelectProps,
  SelectContent,
  type SelectContentProps,
  SelectGroup,
  type SelectGroupProps,
  SelectItem,
  type SelectItemProps,
  SelectLabel,
  type SelectLabelProps,
  SelectTrigger,
  type SelectTriggerProps,
  SelectValue,
  type SelectValueProps,
  Tooltip,
  type TooltipProps,
  TooltipContent,
  type TooltipContentProps,
  TooltipProvider,
  type TooltipProviderProps,
  TooltipTrigger,
  type TooltipTriggerProps,
} from '@gears-frontx/ui-kit'
