import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  fullWidth?: boolean;
}

/** Primary blue CTA everywhere ("Create an Offer", "Purchase License", etc.) */
export function Button({
  variant = "primary",
  fullWidth = false,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  // PWA/mobile: Added min-height for touch targets (44px) and touch-manipulation for better mobile UX
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] touch-manipulation";
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    secondary:
      "bg-white text-text-primary border border-border hover:bg-surface",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
}

