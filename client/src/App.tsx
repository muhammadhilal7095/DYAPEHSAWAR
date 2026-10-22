import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { ShieldX } from 'lucide-react';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/Layout';
import { Empty, Spinner, Modal, Button } from './components/ui';
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';

const P = {
  Home: lazy(() => import('./pages/Home')),
  Tasks: lazy(() => import('./pages/Tasks')),
  Notifications: lazy(() => import('./pages/Notifications')),
  Profile: lazy(() => import('./pages/Profile')),
  // DAAMR
  DaamrDashboard: lazy(() => import('./pages/daamr/Dashboard')),
  ActivityDashboard: lazy(() => import('./pages/daamr/ActivityDashboard')),
  ActivityForm: lazy(() => import('./pages/daamr/ActivityForm')),
  RequestList: lazy(() => import('./pages/daamr/RequestList')),
  ActivityDetail: lazy(() => import('./pages/daamr/ActivityDetail')),
  Assignments: lazy(() => import('./pages/daamr/Assignments')),
  ReportForm: lazy(() => import('./pages/daamr/ReportForm')),
  ReportList: lazy(() => import('./pages/daamr/ReportList')),
  ReportDetail: lazy(() => import('./pages/daamr/ReportDetail')),
  DaamrGallery: lazy(() => import('./pages/daamr/Gallery')),
  DaamrAnalytics: lazy(() => import('./pages/daamr/Analytics')),
  ReportsHub: lazy(() => import('./pages/daamr/ReportsHub')),
  // Courses
  CourseList: lazy(() => import('./pages/courses/CourseList')),
  CourseDetail: lazy(() => import('./pages/courses/CourseDetail')),
  SessionPage: lazy(() => import('./pages/courses/SessionPage')),
  // Hostels
  HostelDashboard: lazy(() => import('./pages/hostel/Dashboard')),
  BookingForm: lazy(() => import('./pages/hostel/BookingForm')),
  BookingRegister: lazy(() => import('./pages/hostel/Register')),
  BookingDetail: lazy(() => import('./pages/hostel/BookingDetail')),
  Operations: lazy(() => import('./pages/hostel/Operations')),
  HostelsAdmin: lazy(() => import('./pages/hostel/HostelsAdmin')),
  HostelReports: lazy(() => import('./pages/hostel/Reports')),
  // Jawan Markaz
  JmDashboard: lazy(() => import('./pages/jm/Dashboard')),
  JmAssets: lazy(() => import('./pages/jm/Assets')),
  JmAssetDetail: lazy(() => import('./pages/jm/AssetDetail')),
  JmReportForm: lazy(() => import('./pages/jm/ReportForm')),
  JmReportList: lazy(() => import('./pages/jm/ReportList')),
  JmReportDetail: lazy(() => import('./pages/jm/ReportDetail')),
  JmRegisters: lazy(() => import('./pages/jm/Registers')),
  JmAnalytics: lazy(() => import('./pages/jm/Analytics')),
  JmGallery: lazy(() => import('./pages/jm/Gallery')),
  // Admin
  Users: lazy(() => import('./pages/admin/Users')),
  Org: lazy(() => import('./pages/admin/Org')),
  Workflows: lazy(() => import('./pages/admin/Workflows')),
  Settings: lazy(() => import('./pages/admin/Settings')),
  EmailLogs: lazy(() => import('./pages/admin/EmailLogs')),
  AuditLogs: lazy(() => import('./pages/admin/AuditLogs')),
};

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.mustChangePassword && loc.pathname !== '/profile') return <Navigate to="/profile?first=1" replace />;
  return <>{children}</>;
}

/** Hides pages the user has no permission for. (The API enforces the same rules.) */
function Gate({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perms)) return <Empty title="Access restricted" icon={<ShieldX className="size-8" />}>You do not have permission to view this page.</Empty>;
  return <>{children}</>;
}

function SessionExpired() {
  const { expired } = useAuth();
  return (
    <Modal open={expired} onClose={() => (window.location.href = '/login')} title="Session expired" size="sm" footer={<Button onClick={() => (window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`)}>Sign in again</Button>}>
      <p className="text-sm text-ink-2">For your security you were signed out after a period of inactivity. Unsaved changes on this page may be lost.</p>
    </Modal>
  );
}

const g = (perms: string[], el: ReactNode) => <Gate perms={perms}>{el}</Gate>;

export function App() {
  return (
    <>
      <SessionExpired />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<P.Home />} />
            <Route path="tasks" element={<P.Tasks />} />
            <Route path="notifications" element={<P.Notifications />} />
            <Route path="profile" element={<P.Profile />} />

            <Route path="daamr" element={g(['daamr.dashboard', 'daamr.request.create', 'daamr.report.create', 'daamr.assign'], <P.ActivityDashboard />)} />
            <Route path="daamr/assignments" element={<P.Assignments />} />
            <Route path="daamr/requests" element={<P.RequestList />} />
            <Route path="daamr/requests/new" element={g(['daamr.request.create'], <P.ActivityForm />)} />
            <Route path="daamr/requests/:id" element={<P.ActivityDetail />} />
            <Route path="daamr/requests/:id/edit" element={g(['daamr.request.create'], <P.ActivityForm />)} />
            <Route element={<P.ReportsHub />}>
              <Route path="daamr/reports" element={<P.ReportList />} />
              <Route path="daamr/analytics" element={g(['daamr.dashboard'], <P.DaamrAnalytics />)} />
              <Route path="daamr/summary" element={g(['daamr.dashboard', 'daamr.request.create'], <P.DaamrDashboard />)} />
            </Route>
            <Route path="daamr/reports/new" element={<P.ReportForm />} />
            <Route path="daamr/reports/:id" element={<P.ReportDetail />} />
            <Route path="daamr/reports/:id/edit" element={<P.ReportForm />} />
            <Route path="daamr/gallery" element={<P.DaamrGallery />} />

            <Route path="courses" element={<P.CourseList />} />
            <Route path="courses/:id" element={<P.CourseDetail />} />
            <Route path="courses/:courseId/sessions/:sid" element={<P.SessionPage />} />

            <Route path="hostels" element={g(['hostel.dashboard', 'hostel.booking.create', 'hostel.operations'], <P.HostelDashboard />)} />
            <Route path="hostels/bookings" element={<P.BookingRegister />} />
            <Route path="hostels/bookings/new" element={g(['hostel.booking.create'], <P.BookingForm />)} />
            <Route path="hostels/bookings/:id" element={<P.BookingDetail />} />
            <Route path="hostels/bookings/:id/edit" element={g(['hostel.booking.create'], <P.BookingForm />)} />
            <Route path="hostels/operations" element={g(['hostel.operations'], <P.Operations />)} />
            <Route path="hostels/manage" element={g(['hostel.manage'], <P.HostelsAdmin />)} />
            <Route path="hostels/reports" element={g(['hostel.dashboard'], <P.HostelReports />)} />

            <Route path="jm" element={g(['jm.dashboard', 'jm.report.create'], <P.JmDashboard />)} />
            <Route path="jm/assets" element={<P.JmAssets />} />
            <Route path="jm/assets/:id" element={<P.JmAssetDetail />} />
            <Route path="jm/reports" element={<P.JmReportList />} />
            <Route path="jm/reports/new" element={g(['jm.report.create'], <P.JmReportForm />)} />
            <Route path="jm/reports/:id" element={<P.JmReportDetail />} />
            <Route path="jm/reports/:id/edit" element={g(['jm.report.create'], <P.JmReportForm />)} />
            <Route path="jm/registers" element={<P.JmRegisters />} />
            <Route path="jm/gallery" element={<P.JmGallery />} />
            <Route path="jm/analytics" element={g(['jm.dashboard'], <P.JmAnalytics />)} />

            <Route path="admin/users" element={g(['admin.users'], <P.Users />)} />
            <Route path="admin/org" element={g(['admin.org'], <P.Org />)} />
            <Route path="admin/workflows" element={g(['admin.workflows'], <P.Workflows />)} />
            <Route path="admin/settings" element={g(['admin.settings'], <P.Settings />)} />
            <Route path="admin/emails" element={g(['email.view'], <P.EmailLogs />)} />
            <Route path="admin/audit" element={g(['audit.view'], <P.AuditLogs />)} />
            <Route path="*" element={<Empty title="Page not found" />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
