import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { db, collection, addDoc, updateDoc, doc, onSnapshot, query, where, handleFirestoreError, OperationType } from '../firebase';
import { Payment, Contract, UserProfile, Property } from '../types';
import { CreditCard, CheckCircle, Clock, AlertCircle, Download, Plus, X, Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ConfirmModal } from '../components/ConfirmModal';

export default function Payments() {
  const { profile, isAdmin, isLandlord, isTenant } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  
  // Filters and Pagination
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Payment>>({
    contractId: '',
    amount: 0,
    dueDate: format(new Date(), 'yyyy-MM-dd'),
    status: 'pending',
  });

  // Confirmation Modals State
  const [confirmPaid, setConfirmPaid] = useState<{ show: boolean; payment: Payment | null }>({ show: false, payment: null });
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!profile) return;

    const qPayments = isAdmin 
      ? collection(db, 'payments') 
      : isTenant 
        ? query(collection(db, 'payments'), where('tenantUid', '==', profile.uid))
        : collection(db, 'payments'); // Landlords see all
    
    const unsubscribePayments = onSnapshot(qPayments, (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'payments');
    });

    const qContracts = isAdmin 
      ? collection(db, 'contracts') 
      : isTenant 
        ? query(collection(db, 'contracts'), where('tenantUid', '==', profile.uid))
        : query(collection(db, 'contracts'), where('landlordUid', '==', profile.uid));

    const unsubscribeContracts = onSnapshot(qContracts, (snapshot) => {
      setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contracts');
    });

    const qUsers = collection(db, 'users');
    const unsubscribeUsers = onSnapshot(qUsers, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    const qProperties = collection(db, 'properties');
    const unsubscribeProperties = onSnapshot(qProperties, (snapshot) => {
      setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'properties');
    });

    return () => {
      unsubscribePayments();
      unsubscribeContracts();
      unsubscribeUsers();
      unsubscribeProperties();
    };
  }, [profile, isAdmin, isLandlord, isTenant]);

  const handleMarkAsPaid = async () => {
    if (!confirmPaid.payment) return;
    try {
      // Create a full ISO string from the selected date
      const selectedDate = new Date(paymentDate);
      // Keep current time if it's today, otherwise just the date
      const now = new Date();
      if (selectedDate.toDateString() === now.toDateString()) {
        selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
      } else {
        selectedDate.setHours(12, 0, 0); // Noon as default for other days
      }

      await updateDoc(doc(db, 'payments', confirmPaid.payment.id), {
        status: 'paid',
        paidAt: selectedDate.toISOString(),
      });
      toast.success('Pagamento baixado com sucesso!');
      setConfirmPaid({ show: false, payment: null });
      setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `payments/${confirmPaid.payment.id}`);
    }
  };

  const generateReceipt = (payment: Payment) => {
    const contract = contracts.find(c => c.id === payment.contractId);
    const tenant = users.find(u => u.uid === payment.tenantUid);
    const landlord = users.find(u => u.uid === contract?.landlordUid) || profile;
    const property = properties.find(p => p.id === contract?.propertyId);

    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.width;

    // Header
    doc.setFillColor(245, 247, 250);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138); // blue-900
    doc.text('RECIBO DE PAGAMENTO', pageWidth / 2, 25, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Recibo Nº: ${payment.id.toUpperCase()}`, pageWidth - margin, 35, { align: 'right' });

    let yPos = 50;

    // Info Table
    autoTable(doc, {
      startY: yPos,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      body: [
        ['Locador', landlord?.displayName || 'N/A', 'CPF', landlord?.cpf || 'N/A'],
        ['Locatário', tenant?.displayName || 'N/A', 'CPF', tenant?.cpf || 'N/A'],
        ['Imóvel', property?.address || 'N/A', 'Contrato', contract?.id.slice(0,8) || 'N/A'],
      ],
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;

    // Payment Details
    autoTable(doc, {
      startY: yPos,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: [243, 244, 246], textColor: 0, fontStyle: 'bold' },
      body: [
        ['Vencimento', format(parseISO(payment.dueDate), 'dd/MM/yyyy')],
        ['Data do Pagamento', payment.paidAt ? format(parseISO(payment.paidAt), 'dd/MM/yyyy HH:mm') : 'N/A'],
        ['Valor Pago', `R$ ${payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
        ['Status', payment.status === 'paid' ? 'PAGO' : 'PENDENTE'],
      ],
    });

    yPos = (doc as any).lastAutoTable.finalY + 20;

    // Declaration
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);
    const declaration = `Recebi(emos) de ${tenant?.displayName || 'N/A'}, a importância de R$ ${payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, referente ao aluguel do imóvel situado à ${property?.address || 'N/A'}, com vencimento em ${format(parseISO(payment.dueDate), 'dd/MM/yyyy')}.`;
    const lines = doc.splitTextToSize(declaration, pageWidth - 2 * margin);
    doc.text(lines, margin, yPos);

    yPos += lines.length * 7 + 30;

    // Signatures
    doc.setDrawColor(150, 150, 150);
    doc.line(margin + 20, yPos, pageWidth - margin - 20, yPos);
    doc.setFontSize(10);
    doc.text(landlord?.displayName?.toUpperCase() || 'LOCADOR', pageWidth / 2, yPos + 5, { align: 'center' });
    doc.text('Locador / Recebedor', pageWidth / 2, yPos + 10, { align: 'center' });

    const pdfBlobUrl = doc.output('bloburl');
    window.open(pdfBlobUrl, '_blank');
    toast.success('Comprovante gerado com sucesso!');
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, searchQuery]);

  const filteredPayments = payments.filter(payment => {
    const matchesStatus = filterStatus === 'all' || payment.status === filterStatus;
    
    const tenant = users.find(u => u.uid === payment.tenantUid);
    const contract = contracts.find(c => c.id === payment.contractId);
    const property = properties.find(p => p.id === contract?.propertyId);
    
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      tenant?.displayName.toLowerCase().includes(searchLower) ||
      property?.address?.toLowerCase().includes(searchLower) ||
      payment.id.toLowerCase().includes(searchLower);

    return matchesStatus && matchesSearch;
  }).sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const totalPages = Math.ceil(filteredPayments.length / itemsPerPage);
  const paginatedPayments = filteredPayments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile) return;

    try {
      const contract = contracts.find(c => c.id === formData.contractId);
      if (!contract) return;

      const data = { 
        ...formData, 
        tenantUid: contract.tenantUid,
        status: 'pending' 
      };
      await addDoc(collection(db, 'payments'), data);
      toast.success('Cobrança gerada com sucesso!');
      setIsModalOpen(false);
      setConfirmGenerate(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'payments');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Pagamentos</h2>
          <p className="text-gray-500">Controle financeiro e baixa de mensalidades.</p>
        </div>
        {(isAdmin || isLandlord) && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Gerar Cobrança
          </button>
        )}
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por inquilino, imóvel ou ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-gray-400" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
            <option value="all">Todos os Status</option>
            <option value="pending">Pendentes</option>
            <option value="paid">Pagos</option>
            <option value="overdue">Atrasados</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {paginatedPayments.map((payment) => {
          const tenant = users.find(u => u.uid === payment.tenantUid);
          const contract = contracts.find(c => c.id === payment.contractId);
          const property = properties.find(p => p.id === contract?.propertyId);

          return (
            <div key={payment.id} className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:border-blue-100 dark:hover:border-blue-900 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  payment.status === 'paid' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 
                  payment.status === 'overdue' ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                }`}>
                  {payment.status === 'paid' ? <CheckCircle className="w-6 h-6" /> : 
                   payment.status === 'overdue' ? <AlertCircle className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Mensalidade</p>
                    <span className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      R$ {payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Vencimento: {format(parseISO(payment.dueDate), 'dd/MM/yyyy')}</p>
                  {(isAdmin || isLandlord) && tenant && (
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 font-medium">Inquilino: {tenant.displayName}</p>
                  )}
                  {property && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-tight">{property.address}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-auto">
                <span className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                  payment.status === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 
                  payment.status === 'overdue' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                }`}>
                  {payment.status === 'paid' ? 'Pago' : payment.status === 'overdue' ? 'Atrasado' : 'Aguardando'}
                </span>
                
                {payment.status === 'paid' ? (
                  <button
                    onClick={() => generateReceipt(payment)}
                    className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                    title="Baixar Comprovante"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                ) : (isAdmin || isLandlord) && (
                  <button
                    onClick={() => setConfirmPaid({ show: true, payment })}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
                  >
                    Dar Baixa
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filteredPayments.length === 0 && (
          <div className="p-12 text-center bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
            <CreditCard className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 dark:text-gray-500">Nenhum pagamento encontrado.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Mostrando <span className="font-bold text-gray-900 dark:text-white">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-bold text-gray-900 dark:text-white">{Math.min(currentPage * itemsPerPage, filteredPayments.length)}</span> de <span className="font-bold text-gray-900 dark:text-white">{filteredPayments.length}</span> pagamentos
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-90"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300 px-3 py-1 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-100 dark:border-gray-700">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-90"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Gerar Cobrança</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Contrato</label>
                <select
                  required
                  value={formData.contractId}
                  onChange={(e) => {
                    const c = contracts.find(con => con.id === e.target.value);
                    setFormData({ ...formData, contractId: e.target.value, amount: c?.monthlyRent || 0 });
                  }}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                >
                  <option value="">Selecione um contrato</option>
                  {contracts.filter(c => c.status === 'active').map(c => (
                    <option key={c.id} value={c.id}>Contrato #{c.id.slice(0, 8)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Valor (R$)</label>
                <input
                  type="number"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Data de Vencimento</label>
                <input
                  type="date"
                  required
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmGenerate(true)}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-semibold text-sm shadow-sm hover:shadow-md active:scale-95"
                >
                  Gerar Cobrança
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={confirmPaid.show}
        onCancel={() => setConfirmPaid({ show: false, payment: null })}
        onConfirm={handleMarkAsPaid}
        title="Confirmar Pagamento"
        message={`Deseja realmente marcar este pagamento de R$ ${confirmPaid.payment?.amount.toLocaleString('pt-BR')} como PAGO?`}
        confirmText="Confirmar"
      >
        <div className="mt-4">
          <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Data do Pagamento</label>
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
          />
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={confirmGenerate}
        onCancel={() => setConfirmGenerate(false)}
        onConfirm={() => handleSubmit()}
        title="Confirmar Nova Cobrança"
        message="Deseja realmente gerar esta nova cobrança para o contrato selecionado?"
        confirmText="Gerar Cobrança"
      />
    </div>
  );
}
