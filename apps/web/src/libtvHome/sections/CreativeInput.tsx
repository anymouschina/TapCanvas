import { ArrowUp } from "lucide-react";

export default function CreativeInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = value.trim().length > 0;

  return (
    <div className="libtv-creative-input mx-auto w-full max-w-[680px] px-4 py-8">
      <div className="libtv-creative-input__surface relative bg-[#1e1e1e] border border-[#333333] rounded-xl p-4 focus-within:border-[#555555] focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) onSubmit();
          }}
          placeholder="输入你的故事创意，例如：一个能听见谎言的律师，接到了一桩所有人都说真话的案子"
          className="libtv-creative-input__textarea w-full min-h-[80px] bg-transparent text-white placeholder-[#666666] text-[15px] resize-none outline-none"
          maxLength={1200}
        />
        <div className="libtv-creative-input__footer mt-3 flex items-center justify-between">
          <span className="libtv-creative-input__hint text-xs text-[#777]">
            Ctrl / ⌘ + Enter 提交 · {value.length}/1200
          </span>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="提交创作灵感"
            className="libtv-creative-input__submit flex h-9 w-9 items-center justify-center rounded-full bg-[#4c6fff] text-white transition-colors hover:bg-[#6380ff] disabled:cursor-not-allowed disabled:bg-[#333] disabled:text-[#777]"
          >
            <ArrowUp className="libtv-creative-input__submit-icon h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
