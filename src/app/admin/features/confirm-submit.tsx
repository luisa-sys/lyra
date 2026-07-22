'use client';

/**
 * KAN-408: submit button with an optional confirm() gate. The admin Features
 * page is a server component; turning a security-sensitive feature (e.g. age
 * verification) OFF disables a safety control, so we require an explicit
 * confirmation before the form posts to setGlobalFeature. When `confirmMessage`
 * is undefined the button submits normally.
 */
export default function ConfirmSubmit({
  confirmMessage,
  className,
  children,
}: {
  confirmMessage?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
