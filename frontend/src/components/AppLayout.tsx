import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ClipboardList, CreditCard, LayoutDashboard, ListChecks, Sparkles, Menu, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { InitialsAvatar } from '@/components/common/InitialsAvatar';
import { ScrollToHash } from '@/components/ScrollToHash';
import { useAuthStore } from '@/store/authStore';
import { APP_NAME, APP_GLYPH } from '@/brand';
import type { FunctionComponent } from '@/common/types';

/**
 * AppLayout — the ONE shared shell every page renders inside. The approved
 * design is a signed-in product screen (a photo-retouching studio) whose own
 * chrome is a left sidebar + sticky topbar, not a marketing navbar — so that
 * sidebar/topbar IS this app's chrome for authenticated users. Signed-out
 * routes (/login, /signup) draw their own full-bleed screens and get no
 * chrome here, matching the approved design (which has no public face).
 */

const MEMBER_NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, editId: '4', iconEditId: '5', labelEditId: '6' },
  { to: '/enhance/new', label: 'New enhancement', icon: Sparkles, editId: '7', iconEditId: '8', labelEditId: '9' },
  { to: '/credits', label: 'Credits & billing', icon: CreditCard, editId: '14', iconEditId: '15', labelEditId: '16' },
] as const;

const ADMIN_NAV_ITEMS = [
  { to: '/admin/requests', label: 'Request monitor', icon: ClipboardList, editId: '7', iconEditId: '8', labelEditId: '9' },
  { to: '/admin/jobs', label: 'Job tracker', icon: ListChecks, editId: '11', iconEditId: '12', labelEditId: '13' },
] as const;

const BrandMark = (): FunctionComponent => (
  <span
    data-edit-id="sec-0:span:1"
    aria-hidden
    className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-[--mint] text-[--mint-dark]"
  >
    <span className="text-base leading-none">{APP_GLYPH}</span>
  </span>
);

type NavItem = (typeof MEMBER_NAV_ITEMS)[number] | (typeof ADMIN_NAV_ITEMS)[number];

function NavLinks({ items, onNavigate }: { items: readonly NavItem[]; onNavigate?: () => void }): FunctionComponent {
  return (
    <nav className="mt-2 grid gap-1">
      {items.map(({ to, label, icon: Icon, editId, iconEditId, labelEditId }) => (
        <NavLink
          key={to}
          data-edit-id={`sec-0:a:${editId}`}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex min-h-[43px] items-center gap-3 rounded-[10px] px-3 text-sm font-semibold transition-colors duration-200 ${
              isActive
                ? 'bg-white text-foreground shadow-[0_3px_12px_rgba(24,32,31,.08)]'
                : 'text-muted-foreground hover:bg-white/70 hover:text-foreground'
            }`
          }
        >
          <span data-edit-id={`sec-0:span:${iconEditId}`} className="grid size-[18px] shrink-0 place-items-center">
            <Icon className="size-[18px]" strokeWidth={1.9} />
          </span>
          <span data-edit-id={`sec-0:span:${labelEditId}`}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarProfile(): FunctionComponent {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = (): void => {
    logout();
    navigate('/');
  };

  if (!user) return <></>;

  const displayName = user.displayName || (user.isAdmin ? 'Admin' : user.email);

  return (
    <div data-edit-id="sec-0:div:22" className="flex items-center gap-2.5 border-t border-border px-2 pt-3">
      <InitialsAvatar name={displayName} size="sm" />
      <div data-edit-id="sec-0:div:24" className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold">{displayName}</p>
        <p data-edit-id="sec-0:span:26" className="truncate text-[10px] text-muted-foreground">
          {user.isAdmin ? 'Admin' : 'Photo workspace'}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-edit-id="sec-0:div:27"
            type="button"
            aria-label="Account menu"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-white/70 hover:text-foreground"
          >
            •••
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!user.isAdmin && (
            <DropdownMenuItem asChild>
              <Link to="/credits">Credits &amp; billing</Link>
            </DropdownMenuItem>
          )}
          {!user.isAdmin && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={handleLogout}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SidebarContents({ onNavigate }: { onNavigate?: () => void }): FunctionComponent {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin === true;
  const items = isAdmin ? ADMIN_NAV_ITEMS : MEMBER_NAV_ITEMS;

  return (
    <div className="flex h-full flex-col px-3 pb-4 pt-6">
      <Link
        data-edit-id="sec-0:a:0"
        to={isAdmin ? '/admin/requests' : '/dashboard'}
        className="flex items-center gap-2.5 px-2 pb-6 text-[18px] font-extrabold tracking-tight text-foreground"
      >
        <BrandMark />
        <span data-edit-id="sec-0:span:2">{APP_NAME}</span>
      </Link>
      <p data-edit-id="sec-0:div:3" className="px-2 text-[10px] font-extrabold uppercase tracking-[1.25px] text-muted-foreground">
        {isAdmin ? 'Admin workspace' : 'My workspace'}
      </p>
      <NavLinks items={items} onNavigate={onNavigate} />

      <div className="flex-1" />

      {!isAdmin && (
        <div className="relative mx-0.5 mb-3 mt-5 overflow-hidden rounded-[14px] bg-[--mint] p-4">
          <div
            aria-hidden
            className="absolute -bottom-9 -right-7 size-[105px] rounded-full border-[17px] border-white/50"
          />
          <p className="relative z-10 text-[18px] font-bold tracking-tight text-[--mint-dark]">
            {user?.creditBalance ?? 0} credits
          </p>
          <p className="relative z-10 mb-2 mt-1 text-[11px] leading-tight text-[#417058]">
            Enough for {user?.creditBalance ?? 0} more enhancement{user?.creditBalance === 1 ? '' : 's'}.
          </p>
          <Link to="/credits" className="relative z-10 text-[11px] font-extrabold text-[--mint-dark] underline underline-offset-2">
            Get more credits →
          </Link>
        </div>
      )}

      <SidebarProfile />
    </div>
  );
}

const PAGE_TITLES: Array<[string, string]> = [
  ['/dashboard', 'Dashboard'],
  ['/enhance/new', 'Upload photo'],
  ['/enhance/', 'New enhancement'],
  ['/requests/', 'Enhancement request'],
  ['/credits', 'Credits & billing'],
  ['/admin/requests', 'Request monitor'],
  ['/admin/jobs', 'Job tracker'],
];

function pageTitleFor(pathname: string): string {
  const match = PAGE_TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return match?.[1] ?? 'Workspace';
}

function Topbar({ onOpenMenu }: { onOpenMenu: () => void }): FunctionComponent {
  const location = useLocation();
  const title = pageTitleFor(location.pathname);

  return (
    <header className="sticky top-0 z-20 flex h-[64px] items-center justify-between border-b border-border/80 bg-card/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:h-[74px] sm:px-10">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation menu"
          className="grid size-9 place-items-center rounded-[10px] border border-border bg-card text-foreground lg:hidden"
        >
          <Menu className="size-[18px]" />
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
          <span>Workspace</span>
          <span className="text-border">/</span>
          <strong className="font-bold text-foreground">{title}</strong>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <Popover>
          <PopoverTrigger asChild>
            <button
              data-edit-id="sec-0:button:35"
              type="button"
              aria-label="Open help"
              className="hidden size-[34px] place-items-center rounded-[10px] border border-border bg-card text-sm font-extrabold text-foreground sm:grid"
            >
              ?
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 text-sm">
            Upload a photo, choose your corrections, then confirm to submit. Each request costs 1 credit — track
            progress from your dashboard.
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              data-edit-id="sec-0:button:36"
              type="button"
              aria-label="Notifications"
              className="grid size-[34px] place-items-center rounded-[10px] border border-border bg-card text-muted-foreground"
            >
              <Bell className="size-4" strokeWidth={1.8} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 text-sm">You're all caught up — no new notifications.</PopoverContent>
        </Popover>
      </div>
    </header>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }): FunctionComponent {
  return (
    <div className={`fixed inset-0 z-40 lg:hidden ${open ? '' : 'pointer-events-none'}`}>
      <div
        onClick={onClose}
        aria-hidden
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`absolute inset-y-0 left-0 w-[238px] max-w-[80vw] bg-[#f1f3ef] shadow-2xl transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation menu"
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <SidebarContents onNavigate={onClose} />
      </div>
    </div>
  );
}

export const AppLayout = (): FunctionComponent => {
  const { user } = useAuthStore();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Signed-out visitor: the approved design has no public face at all, so no
  // navbar/footer here — /login and /signup are full-bleed screens of their own.
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <ScrollToHash />
        <Outlet />
      </div>
    );
  }

  return (
    <div data-sec="sec-0" className="min-h-screen bg-[--soft]">
      <ScrollToHash />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[238px] border-r border-border bg-[#f1f3ef] lg:block">
        <SidebarContents />
      </aside>
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="lg:pl-[238px]">
        <Topbar onOpenMenu={() => setDrawerOpen(true)} />
        <main className="mx-auto max-w-[1680px] px-4 py-6 sm:px-8 sm:py-9 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

/** Standard content column for non-landing pages. */
export const PageContainer = ({ children }: { children: ReactNode }): FunctionComponent => (
  <div className="mx-auto w-full max-w-6xl py-2">{children}</div>
);
