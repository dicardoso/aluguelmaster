import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Toaster } from 'sonner';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';
import Contracts from './pages/Contracts';
import Payments from './pages/Payments';
import Users from './pages/Users';
import Login from './pages/Login';
import Settings from './pages/Settings';
import { useEffect } from 'react';

const ReminderTrigger = () => {
  const { isAdmin, user } = useAuth();

  useEffect(() => {
    if (isAdmin && user) {
      const lastCheck = localStorage.getItem('last_reminder_check');
      const today = new Date().toDateString();

      if (lastCheck !== today) {
        fetch('/api/reminders/process', { method: 'POST' })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              console.log('Reminders processed:', data.results);
              localStorage.setItem('last_reminder_check', today);
            }
          })
          .catch(err => console.error('Error triggering reminders:', err));
      }
    }
  }, [isAdmin, user]);

  return null;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Carregando...</div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
};

export default function App() {
  return (
    <AuthProvider>
      <ReminderTrigger />
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/properties" element={<Properties />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/contracts" element={<Contracts />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
      <Toaster position="top-right" />
    </AuthProvider>
  );
}
