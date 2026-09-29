import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { FunctionComponent } from '@/common/types';

export const NotFound = (): FunctionComponent => (
  <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
    <p className="text-6xl font-bold text-[--mint-dark]">404</p>
    <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
    <p className="max-w-sm text-sm text-muted-foreground">
      The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
    </p>
    <Button asChild className="min-h-[44px]">
      <Link to="/">Back to home</Link>
    </Button>
  </div>
);
