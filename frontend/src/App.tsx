import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { AppLayout } from '@/components/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { GuestRoute } from '@/components/GuestRoute';
import { AdminRoute } from '@/components/AdminRoute';
import { MemberRoute } from '@/components/MemberRoute';
import { SessionWatcher } from '@/components/SessionWatcher';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { Landing } from '@/pages/Landing';
import { Dashboard } from '@/pages/Dashboard';
import { UploadPhoto } from '@/pages/UploadPhoto';
import { ChooseCorrections } from '@/pages/ChooseCorrections';
import { ConfirmEnhancement } from '@/pages/ConfirmEnhancement';
import { RequestDetail } from '@/pages/RequestDetail';
import { Credits } from '@/pages/Credits';
import { AdminRequests } from '@/pages/AdminRequests';
import { AdminJobs } from '@/pages/AdminJobs';
import { NotFound } from '@/pages/NotFound';
import type { FunctionComponent } from '@/common/types';

// Declarative route table — all pages are registered here.
// EVERY page renders inside <AppLayout> (the shared shell) — register new
// routes under it so the whole app keeps ONE consistent chrome.
// Never give an individual page its own <header>/<nav>/<footer>.
const App = (): FunctionComponent => {
	return (
		<>
			{/* Signs the user out and sends them to /login when the session expires. */}
			<SessionWatcher />
			<Routes>
				<Route element={<AppLayout />}>
					{/* Public (guest-only) routes — a signed-in user is sent to APP_HOME. */}
					<Route element={<GuestRoute />}>
						<Route path="/" element={<Landing />} />
						<Route path="/login" element={<Login />} />
						<Route path="/signup" element={<Signup />} />
					</Route>

					{/* Protected routes — redirect to /login when unauthenticated */}
					<Route element={<ProtectedRoute />}>
						{/* Shared between both roles: an owner views their own request,
						    an admin views any request (read-only). */}
						<Route path="/requests/:id" element={<RequestDetail />} />

						{/* Photo Enhancement User (member) screens */}
						<Route element={<MemberRoute />}>
							<Route path="/dashboard" element={<Dashboard />} />
							<Route path="/enhance/new" element={<UploadPhoto />} />
							<Route path="/enhance/:id/options" element={<ChooseCorrections />} />
							<Route path="/enhance/:id/confirm" element={<ConfirmEnhancement />} />
							<Route path="/credits" element={<Credits />} />
						</Route>

						{/* Admin-only monitoring screens */}
						<Route element={<AdminRoute />}>
							<Route path="/admin/requests" element={<AdminRequests />} />
							<Route path="/admin/jobs" element={<AdminJobs />} />
						</Route>
					</Route>

					{/* Unknown paths → a real, friendly 404 (not a bounce to "/"). */}
					<Route path="*" element={<NotFound />} />
				</Route>
			</Routes>
			<Toaster richColors position="top-center" />
		</>
	);
};

export default App;
