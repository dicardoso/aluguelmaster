import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { apiFetch } from '../lib/api';
import { Property, Contract, Payment, UserProfile } from '../types';
import { Building2, CheckCircle2, Clock, AlertCircle, TrendingUp, CalendarClock, FileText, ChevronDown, ChevronUp, ChevronRight, Wallet } from 'lucide-react';
import { format, parseISO, startOfDay, startOfMonth, addMonths, differenceInCalendarDays, isSameMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import DashboardSkeleton from '../components/DashboardSkeleton';
import { formatCurrency } from '../lib/format';

const ATTENTION_COLLAPSED_LIMIT = 4;
const CHART_MONTHS_BACK = 5;
const CHART_MONTHS_AHEAD = 1;
const UPCOMING_LIMIT = 5;

const CARD = 'bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm';

type EffectiveStatus = 'paid' | 'pending' | 'overdue';

// The DB keeps a late payment as `pending` (nothing flips it to `overdue`), so lateness is
// derived from the due date. A payment due today is still on time — compare to start of day.
function effectiveStatus(payment: Payment, today: Date): EffectiveStatus {
  if (payment.status === 'paid') return 'paid';
  return parseISO(payment.dueDate) < today ? 'overdue' : 'pending';
}

// Cancelling a contract leaves its unpaid installments in the DB, so they must not count
// toward totals or alerts.
function livePayments(payments: Payment[], contracts: Contract[]) {
  const dead = new Set(contracts.filter(c => c.status === 'cancelled' || c.status === 'terminated').map(c => c.id));
  return payments.filter(p => !dead.has(p.contractId));
}

const sumAmount = (payments: Payment[]) => payments.reduce((total, p) => total + p.amount, 0);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function relativeDays(days: number) {
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
}

function useDashboardData() {
  const { profile } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [renewalWindowDays, setRenewalWindowDays] = useState(60);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;

    Promise.allSettled([
      apiFetch<Property[]>('/api/properties').then(setProperties),
      apiFetch<Contract[]>('/api/contracts').then(setContracts),
      apiFetch<Payment[]>('/api/payments').then(setPayments),
      apiFetch<any[]>('/api/users/directory').then(data => setUsers(data.map(u => ({ ...u, uid: u.id })))),
      apiFetch<{ renewalWindowDays: number }>('/api/settings/thresholds').then(d => setRenewalWindowDays(d.renewalWindowDays)),
    ]).then((results) => {
      results.forEach((r) => r.status === 'rejected' && console.error('Failed to load dashboard data:', r.reason));
      setLoading(false);
    });
  }, [profile]);

  return { properties, contracts, payments, users, renewalWindowDays, loading };
}

interface AttentionItem {
  id: string;
  kind: 'overdue' | 'expiring' | 'unsigned' | 'vacant';
  title: string;
  detail: string;
  path: string;
  sortKey: number;
}

const ATTENTION_STYLE: Record<AttentionItem['kind'], { label: string; dot: string; chip: string; rank: number }> = {
  overdue: { label: 'Atrasado', dot: 'bg-red-500', chip: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400', rank: 0 },
  expiring: { label: 'Vencendo', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400', rank: 1 },
  unsigned: { label: 'Assinatura', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400', rank: 2 },
  vacant: { label: 'Vago', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400', rank: 3 },
};

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value > 0);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-gray-900 dark:text-white mb-1 capitalize">{label}</p>
      {rows.length === 0 && <p className="text-gray-400">Sem cobranças</p>}
      {rows.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.dataKey}: <span className="font-semibold">{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function ManagerDashboard({ properties, contracts, payments, users, renewalWindowDays }: Omit<ReturnType<typeof useDashboardData>, 'loading'>) {
  const [showAllAttention, setShowAllAttention] = useState(false);
  const today = startOfDay(new Date());

  const propertyById = new Map<string, Property>(properties.map(p => [p.id, p]));
  const contractById = new Map<string, Contract>(contracts.map(c => [c.id, c]));
  const userById = new Map<string, UserProfile>(users.map(u => [u.uid, u]));
  const tenantName = (uid: string) => userById.get(uid)?.displayName || 'Inquilino';
  const propertyAddress = (id: string) => propertyById.get(id)?.address || 'Imóvel';
  const contractLabel = (c: Contract) => `${tenantName(c.tenantUid)} · ${propertyAddress(c.propertyId)}`;

  const live = livePayments(payments, contracts);
  const withStatus = live.map(p => ({ payment: p, status: effectiveStatus(p, today) }));
  const monthPayments = withStatus.filter(({ payment }) => isSameMonth(parseISO(payment.dueDate), today));
  const only = (list: typeof withStatus, status: EffectiveStatus) => list.filter(x => x.status === status).map(x => x.payment);

  const monthExpected = sumAmount(monthPayments.map(x => x.payment));
  const monthReceived = sumAmount(only(monthPayments, 'paid'));
  const monthToReceive = sumAmount(only(monthPayments, 'pending'));
  const overduePayments = only(withStatus, 'overdue');
  const overdueTotal = sumAmount(overduePayments);
  const receivedPct = monthExpected > 0 ? Math.round((monthReceived / monthExpected) * 100) : 0;

  const rentedCount = properties.filter(p => p.status === 'rented').length;
  const occupancyPct = properties.length > 0 ? Math.round((rentedCount / properties.length) * 100) : 0;
  const vacantCount = properties.filter(p => p.status === 'available').length;

  const activeContracts = contracts.filter(c => c.status === 'active');
  const attention: AttentionItem[] = [];

  overduePayments.forEach(p => {
    const contract = contractById.get(p.contractId);
    const due = parseISO(p.dueDate);
    const days = differenceInCalendarDays(today, due);
    attention.push({
      id: `payment-${p.id}`,
      kind: 'overdue',
      title: contract ? contractLabel(contract) : tenantName(p.tenantUid),
      detail: `${formatCurrency(p.amount)} venceu em ${format(due, 'dd/MM/yyyy')} · ${days} ${plural(days, 'dia', 'dias')} de atraso`,
      path: '/payments',
      sortKey: due.getTime(),
    });
  });

  activeContracts.forEach(c => {
    const end = parseISO(c.endDate);
    const days = differenceInCalendarDays(end, today);
    if (days <= renewalWindowDays) {
      attention.push({
        id: `expiring-${c.id}`,
        kind: 'expiring',
        title: contractLabel(c),
        detail: days < 0
          ? `Venceu em ${format(end, 'dd/MM/yyyy')} e continua ativo`
          : `Vence em ${format(end, 'dd/MM/yyyy')} · ${days === 0 ? 'hoje' : `faltam ${days} ${plural(days, 'dia', 'dias')}`}`,
        path: '/contracts',
        sortKey: end.getTime(),
      });
    }
    if (!c.signedContractUrl) {
      const age = c.createdAt ? differenceInCalendarDays(today, parseISO(c.createdAt)) : null;
      attention.push({
        id: `unsigned-${c.id}`,
        kind: 'unsigned',
        title: contractLabel(c),
        detail: age === null ? 'Aguardando contrato assinado'
          : age === 0 ? 'Criado hoje · aguardando contrato assinado'
          : `Criado há ${age} ${plural(age, 'dia', 'dias')} · aguardando contrato assinado`,
        path: '/contracts',
        sortKey: c.createdAt ? parseISO(c.createdAt).getTime() : 0,
      });
    }
  });

  properties.filter(p => p.status === 'available').forEach(p => {
    attention.push({
      id: `vacant-${p.id}`,
      kind: 'vacant',
      title: p.address,
      detail: `Sem contrato ativo · aluguel de ${formatCurrency(p.monthlyRent)}`,
      path: '/properties',
      sortKey: 0,
    });
  });

  attention.sort((a, b) => ATTENTION_STYLE[a.kind].rank - ATTENTION_STYLE[b.kind].rank || a.sortKey - b.sortKey);
  const visibleAttention = showAllAttention ? attention : attention.slice(0, ATTENTION_COLLAPSED_LIMIT);

  const chartData = Array.from({ length: CHART_MONTHS_BACK + CHART_MONTHS_AHEAD + 1 }, (_, i) => {
    const month = addMonths(startOfMonth(today), i - CHART_MONTHS_BACK);
    const inMonth = withStatus.filter(({ payment }) => isSameMonth(parseISO(payment.dueDate), month));
    return {
      name: format(month, 'MMM/yy', { locale: ptBR }),
      Recebido: sumAmount(only(inMonth, 'paid')),
      Pendente: sumAmount(only(inMonth, 'pending')),
      Atrasado: sumAmount(only(inMonth, 'overdue')),
    };
  });
  const chartHasData = chartData.some(d => d.Recebido + d.Pendente + d.Atrasado > 0);

  const upcoming = only(withStatus, 'pending')
    .sort((a, b) => parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime())
    .slice(0, UPCOMING_LIMIT);

  const monthLabel = format(today, 'MMMM', { locale: ptBR });

  return (
    <div className="space-y-8">
      {/* Attention */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          {attention.length > 0
            ? <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            : <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {attention.length > 0 ? 'Precisa de atenção' : 'Tudo em dia'}
            {attention.length > 0 && <span className="text-gray-400 font-normal"> · {attention.length} {plural(attention.length, 'item', 'itens')}</span>}
            {overduePayments.length > 0 && (
              <span className="text-red-600 dark:text-red-400"> · {overduePayments.length} {plural(overduePayments.length, 'atrasado', 'atrasados')}</span>
            )}
          </p>
        </div>

        {attention.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">Nenhum pagamento atrasado, contrato vencendo ou pendência de assinatura.</p>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {visibleAttention.map(item => {
              const style = ATTENTION_STYLE[item.kind];
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.detail}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0 ${style.chip}`}>{style.label}</span>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </Link>
              );
            })}
          </div>
        )}

        {attention.length > ATTENTION_COLLAPSED_LIMIT && (
          <button
            onClick={() => setShowAllAttention(v => !v)}
            className="w-full px-5 py-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700 transition-colors"
          >
            {showAllAttention ? (
              <>Mostrar menos <ChevronUp className="w-3.5 h-3.5" /></>
            ) : (
              <>Mostrar mais {attention.length - ATTENTION_COLLAPSED_LIMIT} <ChevronDown className="w-3.5 h-3.5" /></>
            )}
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className={`${CARD} p-6`}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-green-100 dark:bg-opacity-10 flex items-center justify-center shrink-0">
              <Wallet className="w-6 h-6 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">Recebido em {monthLabel}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white truncate">{formatCurrency(monthReceived)}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: `${receivedPct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{receivedPct}% dos {formatCurrency(monthExpected)} do mês</p>
          </div>
        </div>

        <div className={`${CARD} p-6 flex items-center gap-4`}>
          <div className="w-12 h-12 rounded-lg bg-orange-100 dark:bg-opacity-10 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6 text-orange-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">A receber em {monthLabel}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white truncate">{formatCurrency(monthToReceive)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">ainda dentro do prazo</p>
          </div>
        </div>

        <div className={`${CARD} p-6 flex items-center gap-4`}>
          <div className="w-12 h-12 rounded-lg bg-red-100 dark:bg-opacity-10 flex items-center justify-center shrink-0">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">Em atraso</p>
            <p className={`text-2xl font-bold truncate ${overdueTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{formatCurrency(overdueTotal)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">{overduePayments.length} {plural(overduePayments.length, 'parcela', 'parcelas')}</p>
          </div>
        </div>

        <div className={`${CARD} p-6 flex items-center gap-4`}>
          <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-opacity-10 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">Ocupação</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{rentedCount} de {properties.length}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {occupancyPct}% alugados{vacantCount > 0 && ` · ${vacantCount} ${plural(vacantCount, 'vago', 'vagos')}`}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cash flow */}
        <div className={`${CARD} p-6 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                Fluxo de Caixa
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Cobranças por mês de vencimento</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs text-gray-500"><div className="w-2 h-2 rounded-full bg-green-500" /> Recebido</span>
              <span className="flex items-center gap-1 text-xs text-gray-500"><div className="w-2 h-2 rounded-full bg-orange-500" /> Pendente</span>
              <span className="flex items-center gap-1 text-xs text-gray-500"><div className="w-2 h-2 rounded-full bg-red-500" /> Atrasado</span>
            </div>
          </div>
          {chartHasData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.05} />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(v))}
                  />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<ChartTooltip />} />
                  <Bar dataKey="Recebido" stackId="month" fill="#10B981" barSize={36} />
                  <Bar dataKey="Pendente" stackId="month" fill="#F59E0B" barSize={36} />
                  <Bar dataKey="Atrasado" stackId="month" fill="#EF4444" barSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma cobrança no período.</p>
            </div>
          )}
        </div>

        {/* Upcoming dues */}
        <div className={`${CARD} p-6`}>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-blue-600" />
              Próximos vencimentos
            </h3>
            <Link to="/payments" className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">Ver todos</Link>
          </div>
          <div className="space-y-1">
            {upcoming.map(p => {
              const contract = contractById.get(p.contractId);
              const due = parseISO(p.dueDate);
              const days = differenceInCalendarDays(due, today);
              return (
                <Link
                  key={p.id}
                  to="/payments"
                  className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{tenantName(p.tenantUid)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{contract ? propertyAddress(contract.propertyId) : 'Imóvel'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(p.amount)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{format(due, 'dd/MM')} · {relativeDays(days)}</p>
                  </div>
                </Link>
              );
            })}
            {upcoming.length === 0 && (
              <div className="text-center py-12">
                <CalendarClock className="w-12 h-12 text-gray-100 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 dark:text-gray-500 text-sm">Nenhuma parcela a vencer.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Tenants only see their own contracts/payments (API-scoped), and `/api/properties` is
// owner-only, so there's no property address to show here.
function TenantDashboard({ contracts, payments }: Pick<ReturnType<typeof useDashboardData>, 'contracts' | 'payments'>) {
  const today = startOfDay(new Date());
  const withStatus = livePayments(payments, contracts)
    .map(payment => ({ payment, status: effectiveStatus(payment, today) }))
    .sort((a, b) => parseISO(a.payment.dueDate).getTime() - parseISO(b.payment.dueDate).getTime());

  const next = withStatus.find(x => x.status !== 'paid');
  const recent = withStatus.filter(x => x.status !== 'pending').slice(-5).reverse();
  const contract = contracts.find(c => c.status === 'active');

  const nextDue = next ? parseISO(next.payment.dueDate) : null;
  const nextDays = nextDue ? differenceInCalendarDays(nextDue, today) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className={`${CARD} p-6`}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
          <CalendarClock className="w-5 h-5 text-blue-600" />
          Próxima parcela
        </h3>
        {next && nextDue ? (
          <div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(next.payment.amount)}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Vencimento em {format(nextDue, 'dd/MM/yyyy')}</p>
            <span className={`inline-block mt-3 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
              next.status === 'overdue'
                ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
            }`}>
              {next.status === 'overdue'
                ? `Em atraso há ${-nextDays} ${plural(-nextDays, 'dia', 'dias')}`
                : `Vence ${relativeDays(nextDays)}`}
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma parcela em aberto. Tudo em dia!</p>
        )}
        <Link to="/payments" className="inline-block mt-6 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">Ver pagamentos</Link>
      </div>

      <div className={`${CARD} p-6`}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
          <FileText className="w-5 h-5 text-blue-600" />
          Meu contrato
        </h3>
        {contract ? (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Vigência</dt><dd className="font-medium text-gray-900 dark:text-white">{format(parseISO(contract.startDate), 'dd/MM/yyyy')} a {format(parseISO(contract.endDate), 'dd/MM/yyyy')}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Valor mensal</dt><dd className="font-medium text-gray-900 dark:text-white">{formatCurrency(contract.monthlyRent)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Vencimento</dt><dd className="font-medium text-gray-900 dark:text-white">Todo dia {contract.dueDay}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Assinatura</dt><dd className="font-medium text-gray-900 dark:text-white">{contract.signedContractUrl ? 'Assinado' : 'Aguardando assinatura'}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Você não possui contrato ativo.</p>
        )}
        <Link to="/contracts" className="inline-block mt-6 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">Ver contratos</Link>
      </div>

      <div className={`${CARD} p-6 lg:col-span-2`}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Últimos pagamentos</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum pagamento vencido até agora.</p>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {recent.map(({ payment, status }) => (
              <div key={payment.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(payment.amount)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Vencimento em {format(parseISO(payment.dueDate), 'dd/MM/yyyy')}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                  status === 'paid'
                    ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {status === 'paid' ? 'Pago' : 'Atrasado'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { profile, isTenant } = useAuth();
  const { loading, ...data } = useDashboardData();

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Olá, {profile?.displayName}</h2>
        <p className="text-gray-500 dark:text-gray-400">
          {isTenant ? 'Acompanhe suas parcelas e seu contrato.' : 'O que precisa da sua atenção e como estão as finanças.'}
        </p>
      </div>
      {isTenant
        ? <TenantDashboard contracts={data.contracts} payments={data.payments} />
        : <ManagerDashboard {...data} />}
    </div>
  );
}
