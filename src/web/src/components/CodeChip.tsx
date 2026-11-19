import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CodeChip({ code, onCopy }: { code: string; onCopy: (code: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCopy(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className={
        "inline-flex max-w-[46vw] items-center gap-1 truncate rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors sm:max-w-none sm:py-0.5 " +
        (copied
          ? "bg-deal-subtle text-deal"
          : "bg-code-subtle text-code hover:bg-amber-200/70")
      }
      title="点击复制兑换码"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {code}
    </button>
  );
}

