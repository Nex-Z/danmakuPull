import type { PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

export function FieldGroup({
  className,
  children
}: PropsWithChildren<{ className?: string }>) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

export function Field({
  className,
  orientation = "vertical",
  children
}: PropsWithChildren<{
  className?: string;
  orientation?: "vertical" | "horizontal";
}>) {
  return (
    <div
      className={cn(
        orientation === "horizontal"
          ? "grid gap-3 md:grid-cols-[180px_1fr]"
          : "flex flex-col gap-2",
        className
      )}
    >
      {children}
    </div>
  );
}

export function FieldTitle({
  className,
  children
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn("text-sm font-medium text-foreground", className)}>
      {children}
    </div>
  );
}

export function FieldLabel({
  className,
  htmlFor,
  children
}: PropsWithChildren<{ className?: string; htmlFor?: string }>) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("text-sm font-medium text-foreground", className)}
    >
      {children}
    </label>
  );
}

export function FieldDescription({
  className,
  children
}: PropsWithChildren<{ className?: string }>) {
  return (
    <p className={cn("text-sm leading-6 text-muted-foreground", className)}>
      {children}
    </p>
  );
}
