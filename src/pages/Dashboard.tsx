import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiFetch } from '../lib/api';
import { Property, Contract, Payment } from '../types';
import { Building2, FileText, CreditCard, AlertCircle, TrendingUp, Users } from 'lucide-react';
import { format, isAfter, isBefore, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function Dashboard() {
  const { profile } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    if (!profile) return;

    apiFetch<Property[]>('/api/properties').then(setProperties).catch((error) => {
      console.error('Failed to load properties:', error);
    });
    apiFetch<Contract[]>('/api/contracts').then(setContracts).catch((error) => {
      console.error('Failed to load contracts:', error);
    });
    apiFetch<Payment[]>('/api/payments').then(setPayments).catch((error) => {
      console.error('Failed to load payments:', error);
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

  const chartData = [
    { name: 'Pago', value: payments.filter(p => p.status === 'paid').length },
    { name: 'Pendente', value: payments.filter(p => p.status === 'pending').length },
    { name: 'Atrasado', value: payments.filter(p => p.status === 'overdue').length },
  ];

  const COLORS = ['#10B981', '#F59E0B', '#EF4444'];

  const [notifications, setNotifications] = useState<{ id: string; title: string; type: 'warning' | 'error' }[]>([]);

  useEffect(() => {
    const newNotifications: { id: string; title: string; type: 'warning' | 'error' }[] = [];
    
    // Check expiring contracts
    contracts.forEach(c => {
      const expiry = new Date(c.endDate);
      if (isAfter(expiry, new Date()) && isBefore(expiry, addDays(new Date(), 30))) {
        newNotifications.push({ 
          id: `contract-${c.id}`, 
          title: `Contrato #${c.id.slice(0, 6)} vence em ${format(expiry, 'dd/MM/yyyy')}`, 
          type: 'warning' 
        });
      }
    });

    // Check overdue payments
    payments.forEach(p => {
      if (p.status === 'pending' && isBefore(new Date(p.dueDate), new Date())) {
        newNotifications.push({ 
          id: `payment-${p.id}`, 
          title: `Pagamento de R$ ${p.amount} está atrasado (Vencimento: ${format(new Date(p.dueDate), 'dd/MM/yyyy')})`, 
          type: 'error' 
        });
      }
    });

    setNotifications(newNotifications);
  }, [contracts, payments]);

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
        <div className="space-y-3">
          {notifications.map(notif => (
            <div key={notif.id} className={`p-4 rounded-xl border flex items-center gap-3 ${
              notif.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-400' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-900/30 text-orange-700 dark:text-orange-400'
            }`}>
              <AlertCircle className="w-5 h-5" />
              <p className="text-sm font-medium">{notif.title}</p>
            </div>
          ))}
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
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Fluxo de Caixa
            </h3>
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
