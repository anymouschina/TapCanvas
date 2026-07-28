import { useState, useEffect } from "react";
import { ArrowRight, Crown, Sparkles } from "lucide-react";

type NavbarProps = {
  onCreate: () => void;
};

export default function Navbar({ onCreate }: NavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 h-14 flex items-center justify-between px-4 md:px-6 transition-all duration-300 ${
        isScrolled
          ? "bg-[#141414]/95 backdrop-blur-xl shadow-lg shadow-black/20"
          : "bg-[#141414]/80 backdrop-blur-md"
      }`}
    >
      <div className="libtv-navbar__brand-wrap flex items-center">
        <a href="/" className="libtv-navbar__brand flex items-center gap-2 text-white">
          <span className="libtv-navbar__brand-icon flex h-7 w-7 items-center justify-center rounded-lg bg-[#4c6fff]">
            <Sparkles className="libtv-navbar__brand-glyph h-4 w-4" aria-hidden="true" />
          </span>
          <span className="libtv-navbar__brand-label text-lg font-semibold tracking-tight">HMaigc</span>
        </a>
      </div>

      <div className="libtv-navbar__actions flex items-center gap-2">
        <a
          className="libtv-navbar__membership hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[#b8b8b8] transition-colors hover:bg-white/5 hover:text-white sm:flex"
          href="/membership"
        >
          <Crown className="libtv-navbar__membership-icon h-4 w-4" aria-hidden="true" />
          <span className="libtv-navbar__membership-label">会员方案</span>
        </a>

        <button
          type="button"
          onClick={onCreate}
          className="libtv-navbar__workspace flex items-center gap-1.5 rounded-lg bg-[#4c6fff] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6380ff]"
        >
          <span className="libtv-navbar__workspace-label">进入工作台</span>
          <ArrowRight className="libtv-navbar__workspace-icon h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
