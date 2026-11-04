// Copied from gc3274/hw1@3eb3337 components/SubmitButton.tsx; keep in sync
"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Spinner from "./Spinner";
import { button, type ButtonSize, type ButtonVariant } from "./ui";

type SubmitButtonProps = Omit<ComponentPropsWithoutRef<"button">, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingText?: ReactNode;
};

// Must be rendered inside the <form> it submits, since useFormStatus reads the parent form
export default function SubmitButton({
  variant = "primary",
  size = "md",
  pendingText,
  className = "",
  disabled,
  children,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      type="submit"
      disabled={pending || disabled}
      className={`${button(variant, size)} ${className}`}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
