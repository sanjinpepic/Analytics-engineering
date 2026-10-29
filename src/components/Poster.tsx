/** The 1912 poster lettering lockup: a large first line, a swash-flanked second line, a meta line. */
export function Swash({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 40 20" width="34" height="17" aria-hidden className={flip ? 'hidden shrink-0 -scale-x-100 sm:block' : 'hidden shrink-0 sm:block'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M38 10c-6 0-8-7-14-7-5 0-7 4-4 7 3 3 7 0 5-2" />
      <path d="M38 10c-8 0-10 7-17 7-4 0-6-2-6-4" />
    </svg>
  );
}

export function PosterLettering({ id, title, subtitle, meta }: { id?: string; title: string; subtitle: string; meta: string }) {
  return (
    <div className="text-center text-[var(--poster-ink)]">
      <h1 id={id} className="font-display mx-auto max-w-[16ch] text-[42px] leading-[0.95] text-balance uppercase sm:text-[60px] lg:text-[76px]">
        {title}
      </h1>
      <p className="font-display mt-4 flex items-center justify-center gap-2 text-[26px] leading-tight uppercase sm:gap-3 sm:text-[36px]">
        <Swash /> <span className="text-balance">{subtitle}</span> <Swash flip />
      </p>
      <p className="font-display mt-1.5 text-[24px] uppercase tnum sm:text-[28px]">{meta}</p>
    </div>
  );
}
