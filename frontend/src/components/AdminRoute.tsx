import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import type { FunctionComponent } from '@/common/types';

/**
 * AdminRoute — layout route nested INSIDE ProtectedRoute. A signed-in member
 * (not admin) who reaches an admin-only path is sent to their own dashboard
 * instead of a 403 page — admin monitoring pages are not theirs to see.
 * Use as: <Route element={<ProtectedRoute />}><Route element={<AdminRoute />}>…
 */
export const AdminRoute = (): FunctionComponent => {
  const user = useAuthStore((state) => state.user);
  if (!user?.isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
};
