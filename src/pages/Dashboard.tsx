import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { apiFetch } from '../lib/api';
import { Property, Contract, Payment } from '../types';
import { Building2, FileText, CreditCard, AlertCircle, TrendingUp, Users, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { format, isAfter, isBefore, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import PageLoader from '../components/PageLoader';
import { formatCurrency } from '../lib/format';

const NOTIFICATIONS_COLLAPSED_LIMIT = 3;

export default function Dashboard() {
  const { profile } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;

    Promise.allSettled([
      apiFetch<Property[]>('/api/properties').then(setProperties),
      apiFetch<Contract[]>('/api/contracts').then(setContracts),
      apiFetch<Payment[]>('/api/payments').then(setPayments),
    ]).then((results) => {
      results.forEach((r) => r.status === 'rejected' && console.error('Failed to load dashboard data:', r.reason));
      setLoading(false);
    });
  }, [profile]);

  const stats = [
    { name: 'Imóveis', value: properties.length, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-100' },
    { name: 'Contratos Ativos', value: contracts.filter(c => c.status === 'active').length, icon: FileText, color: 'text-green-600', bg: 'bg-green-100' },
    { name: 'Pagamentos Pendentes', value: payments.filter(p => p.status === 'pending').length, icon: CreditCard, color: 'text-orange-600', bg: 'bg-orange-100' },
    { name: 'Contratos a Vencer', value: contracts.filter(c => {
      const expiry = new Date(c.endDate);
      return isAfter(expiry, new Date()) && isBefore(expiry, addDays(new Date(), 30));
    }).length, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100' },
  ];

  const now = new Date();
  const currentMonthPayments = payments.filter(p => {
    const due = new Date(p.dueDate);
    return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth();
  });
  const getEffectivePaymentStatus = (p: Payment): Payment['status'] =>
    p.status === 'pending' && new Date(p.dueDate) < now ? 'overdue' : p.status;

  const chartData = [
    { name: 'Pago', value: currentMonthPayments.filter(p => getEffectivePaymentStatus(p) === 'paid').length },
    { name: 'Pendente', value: currentMonthPayments.filter(p => getEffectivePaymentStatus(p) === 'pending').length },
    { name: 'Atrasado', value: currentMonthPayments.filter(p => getEffectivePaymentStatus(p) === 'overdue').length },
  ];

  const COLORS = ['#10B981', '#F59E0B', '#EF4444'];

  interface DashboardNotification {
    id: string;
    title: string;
    type: 'warning' | 'error';
    path: string;
    sortDate: number;
  }

  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [showAllNotifications, setShowAllNotifications] = useState(false);

  useEffect(() => {
    const newNotifications: DashboardNotification[] = [];

    contracts.forEach(c => {
      const expiry = new Date(c.endDate);
      if (isAfter(expiry, new Date()) && isBefore(expiry, addDays(new Date(), 30))) {
        newNotifications.push({
          id: `contract-${c.id}`,
          title: `Contrato #${c.id.slice(0, 6)} vence em ${format(expiry, 'dd/MM/yyyy')}`,
          type: 'warning',
          path: '/contracts',
          sortDate: expiry.getTime(),
        });
      }
    });

    payments.forEach(p => {
      if (p.status === 'pending' && isBefore(new Date(p.dueDate), new Date())) {
        const dueDate = new Date(p.dueDate);
        newNotifications.push({
          id: `payment-${p.id}`,
          title: `Pagamento de ${formatCurrency(p.amount)} está atrasado (Vencimento: ${format(dueDate, 'dd/MM/yyyy')})`,
          type: 'error',
          path: '/payments',
          sortDate: dueDate.getTime(),
        });
      }
    });

    newNotifications.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'error' ? -1 : 1;
      return a.sortDate - b.sortDate;
    });

    setNotifications(newNotifications);
    setShowAllNotifications(false);
  }, [contracts, payments]);

  const overdueCount = notifications.filter(n => n.type === 'error').length;
  const expiringCount = notifications.filter(n => n.type === 'warning').length;
  const visibleNotifications = showAllNotifications ? notifications : notifications.slice(0, NOTIFICATIONS_COLLAPSED_LIMIT);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Olá, {profile?.displayName}</h2>
          <p className="text-gray-500 dark:text-gray-400">Aqui está o resumo da sua gestão imobiliária.</p>
        </div>
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-red-50/60 dark:bg-red-900/10 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {notifications.length} {notifications.length === 1 ? 'alerta' : 'alertas'}
              {overdueCount > 0 && <span className="text-red-600 dark:text-red-400"> · {overdueCount} atrasado{overdueCount > 1 ? 's' : ''}</span>}
              {expiringCount > 0 && <span className="text-orange-600 dark:text-orange-400"> · {expiringCount} vencendo</span>}
            </p>
          </div>

          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {visibleNotifications.map(notif => (
              <Link
                key={notif.id}
                to={notif.path}
                className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors group"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${notif.type === 'error' ? 'bg-red-500' : 'bg-orange-500'}`} />
                <p className={`text-sm flex-1 truncate ${notif.type === 'error' ? 'text-red-700 dark:text-red-400' : 'text-orange-700 dark:text-orange-400'}`}>
                  {notif.title}
                </p>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            ))}
          </div>

          {notifications.length > NOTIFICATIONS_COLLAPSED_LIMIT && (
            <button
              onClick={() => setShowAllNotifications(v => !v)}
              className="w-full px-5 py-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700 transition-colors"
            >
              {showAllNotifications ? (
                <>Mostrar menos <ChevronUp className="w-3.5 h-3.5" /></>
              ) : (
                <>Mostrar mais {notifications.length - NOTIFICATIONS_COLLAPSED_LIMIT} <ChevronDown className="w-3.5 h-3.5" /></>
              )}
            </button>
          )}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
            <div className={`w-12 h-12 rounded-lg ${stat.bg} dark:bg-opacity-10 flex items-center justify-center shrink-0`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">{stat.name}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Chart */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                Fluxo de Caixa
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{format(now, "MMMM 'de' yyyy", { locale: ptBR })}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-gray-500"><div className="w-2 h-2 rounded-full bg-green-500" /> Pago</span>
              <span className="flex items-center gap-1 text-xs text-gray-500"><div className="w-2 h-2 rounded-full bg-orange-500" /> Pendente</span>
              <span className="flex items-center gap-1 text-xs text-gray-500"><div className="w-2 h-2 rounded-full bg-red-500" /> Atrasado</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.05} />
                <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ 
                    backgroundColor: '#fff', 
                    borderRadius: '8px', 
                    border: '1px solid #f1f5f9', 
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' 
                  }} 
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Contracts */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Contratos Recentes
          </h3>
          <div className="space-y-3">
            {contracts.slice(0, 5).map((contract) => (
              <div key={contract.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Contrato #{contract.id.slice(0, 6)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Expira em {format(new Date(contract.endDate), 'dd/MM/yyyy', { locale: ptBR })}
                    </p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                  contract.status === 'active' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-50 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}>
                  {contract.status === 'active' ? 'Ativo' : contract.status}
                </span>
              </div>
            ))}
            {contracts.length === 0 && (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-gray-100 dark:text-gray-800 mx-auto mb-4" />
                <p className="text-gray-400 dark:text-gray-500 text-sm">Nenhum contrato encontrado.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
