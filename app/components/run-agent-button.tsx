'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function RunAgentButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleRun = () => {
    startTransition(async () => {
      setLastResult(null);
      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await response.json();
        setLastResult(
          `Scanned ${data.scanned}, scheduled ${data.scheduled}, uploaded ${data.uploaded}, failed ${data.failed}`,
        );
        router.refresh();
      } catch (error) {
        setLastResult(`Error: ${(error as Error).message}`);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleRun}
        disabled={isPending}
        className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isPending ? 'Running…' : 'Run Agent Now'}
      </button>
      {lastResult ? <span className="text-sm text-zinc-600">{lastResult}</span> : null}
    </div>
  );
}
