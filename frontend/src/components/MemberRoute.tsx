import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import type { FunctionComponent } from '@/common/types';

/**
 * MemberRoute — the inverse of AdminRoute. Admins monitor the platform; they
 * do not upload photos, submit requests or spend credits, so an admin who
 * reaches a member page (dashboard, enhancement flow, credits) is sent to
 * their own request monitor instead.
 */
export const MemberRoute = (): FunctionComponent => {
  const user = useAuthStore((state) => state.user);
  if (user?.isAdmin) return <Navigate to="/admin/requests" replace />;
  return <Outlet />;
};
