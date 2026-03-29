"use client"

import { useState, useCallback } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
  confirmText?: string // If provided, user must type this to confirm
  onConfirm: () => void | Promise<void>
  isLoading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  confirmText,
  onConfirm,
  isLoading = false,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState("")
  const [loading, setLoading] = useState(false)

  const isConfirmDisabled = confirmText ? inputValue !== confirmText : false
  const effectiveLoading = isLoading || loading

  const handleConfirm = useCallback(async () => {
    setLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
      setInputValue("")
    } catch {
      // Error handling is done by parent
    } finally {
      setLoading(false)
    }
  }, [onConfirm, onOpenChange])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setInputValue("")
      }
      onOpenChange(open)
    },
    [onOpenChange],
  )

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {confirmText && (
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-2">
              Type <span className="font-mono font-semibold text-foreground">{confirmText}</span> to confirm:
            </p>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={confirmText}
              className="font-mono"
              autoFocus
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={effectiveLoading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isConfirmDisabled || effectiveLoading}
            className={cn(
              variant === "destructive" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {effectiveLoading ? "Processing..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// Hook for easier usage
export function useConfirmDialog() {
  const [dialogState, setDialogState] = useState<{
    open: boolean
    title: string
    description: string
    confirmLabel?: string
    variant?: "default" | "destructive"
    confirmText?: string
    onConfirm: () => void | Promise<void>
  }>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  })

  const confirm = useCallback((options: Omit<typeof dialogState, "open">) => {
    return new Promise<boolean>((resolve) => {
      setDialogState({
        ...options,
        open: true,
        onConfirm: async () => {
          await options.onConfirm()
          resolve(true)
        },
      })
    })
  }, [])

  const DialogComponent = (
    <ConfirmDialog {...dialogState} onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))} />
  )

  return { confirm, DialogComponent }
}
