import type { TranscriptTurn } from "@/types/promo";

type ThreadChatProps = {
  transcript: TranscriptTurn[];
  productName?: string;
};

export function ThreadChat({ transcript, productName }: ThreadChatProps) {
  if (!transcript || transcript.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
        <p className="text-sm font-medium text-slate-700">
          まだコメントがありません。
        </p>
        <p className="text-xs text-slate-400">
          まもなく「{productName ?? "この商品"}」について会話が盛り上がります。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {transcript.map((turn) => (
        <article
          key={turn.id}
          className="group flex gap-3 rounded-2xl px-1 py-1 animate-fade-in"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-sm font-bold text-white shadow-sm">
            {(turn.speaker_name || "?").slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-slate-900">
                {turn.speaker_name}
              </span>
              {turn.speaker_attribute && (
                <span className="text-xs text-slate-400">
                  {turn.speaker_attribute}
                </span>
              )}
              {turn.timestamp && (
                <span className="ml-auto text-[10px] text-slate-400">
                  {new Date(turn.timestamp).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </header>
            <div className="inline-block max-w-full rounded-2xl bg-white px-4 py-2.5 text-sm leading-relaxed text-slate-800 shadow-sm ring-1 ring-slate-100 group-hover:ring-slate-200">
              {turn.content}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

