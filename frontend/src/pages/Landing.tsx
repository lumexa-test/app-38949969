import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NAME, APP_GLYPH, APP_TAGLINE } from '@/brand';
import type { FunctionComponent } from '@/common/types';

/**
 * Landing ("/") — the product's public front door. The approved design
 * covers the signed-in workspace only and draws no marketing page, so this
 * stays minimal by design: a headline, what the product is, and a way in —
 * not a full marketing site. Styled with the same tokens as the workspace
 * (mint/paper palette) so a visitor and a signed-in user see one product.
 */
export const Landing = (): FunctionComponent => {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[--soft] px-4 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60rem 30rem at 20% -10%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 60%), radial-gradient(50rem 26rem at 90% 10%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 55%)',
        }}
      />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-[--mint] text-2xl text-[--mint-dark]" aria-hidden>
          {APP_GLYPH}
        </span>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{APP_NAME}</h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">{APP_TAGLINE}</p>

        <ul className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-6">
          <li className="flex items-center gap-1.5">
            <Check className="size-4 text-[--mint-deep]" /> 3 free credits to start
          </li>
          <li className="flex items-center gap-1.5">
            <Check className="size-4 text-[--mint-deep]" /> Before &amp; after comparison
          </li>
          <li className="flex items-center gap-1.5">
            <Check className="size-4 text-[--mint-deep]" /> Pay only as you go
          </li>
        </ul>

        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild size="lg" className="min-h-[44px] w-full sm:w-auto">
            <Link to="/signup">
              Get started free
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="min-h-[44px] w-full sm:w-auto">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};
