import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { apiFetch } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { calculateLateFee } from '../lib/lateFee';
import { Contract, Property, UserProfile, Payment } from '../types';
import { FileText, Plus, Download, RefreshCw, X, Calendar, User, Building2, Mail, XCircle, Upload, CheckCircle2, History, Clock, CheckCircle, AlertCircle, Percent, Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { format, addMonths, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ConfirmModal } from '../components/ConfirmModal';
import ContractsTableSkeleton from '../components/ContractsTableSkeleton';

function daysUntil(dateStr: string) {
  return (new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

export default function Contracts() {
  const { profile, isAdmin, isLandlord } = useAuth();
  // Server-configured (Settings page); 60 is just the fallback while it loads.
  const [renewalWindowDays, setRenewalWindowDays] = useState(60);
  const isRenewable = (contract: Contract) =>
    contract.status === 'active' && daysUntil(contract.endDate) <= renewalWindowDays;
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [contractToRenew, setContractToRenew] = useState<Contract | null>(null);
  const [renewNewRent, setRenewNewRent] = useState('');
  const [contractToCancel, setContractToCancel] = useState<Contract | null>(null);
  const [selectedContractForHistory, setSelectedContractForHistory] = useState<Contract | null>(null);
  const [contractPayments, setContractPayments] = useState<Payment[]>([]);
  const [uploadingContractId, setUploadingContractId] = useState<string | null>(null);

  // Filters and Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const [formData, setFormData] = useState<Partial<Contract>>({
    propertyId: '',
    tenantUid: '',
    landlordUid: '',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(addMonths(new Date(), 12), 'yyyy-MM-dd'),
    dueDay: 10,
    monthlyRent: 0,
    status: 'pending',
  });

  const fetchContracts = useCallback(async () => {
    try {
      setContracts(await apiFetch<Contract[]>('/api/contracts'));
    } catch (error) {
      console.error('Failed to load contracts:', error);
      toast.error('Erro ao carregar contratos.');
    }
  }, []);

  useEffect(() => {
    if (!profile) return;

    Promise.allSettled([
      fetchContracts(),
      apiFetch<Property[]>('/api/properties').then(setProperties),
      apiFetch<UserProfile[]>('/api/users/directory').then((data) => {
        setUsers(data.map((u: any) => ({ ...u, uid: u.id })));
      }),
      apiFetch<{ renewalWindowDays: number }>('/api/settings/thresholds').then((data) => {
        setRenewalWindowDays(data.renewalWindowDays);
      }),
    ]).then((results) => {
      results.forEach((r) => r.status === 'rejected' && console.error('Failed to load contracts page data:', r.reason));
      setLoading(false);
    });
  }, [profile, fetchContracts]);

  useEffect(() => {
    if (!selectedContractForHistory) {
      setContractPayments([]);
      return;
    }

    apiFetch<Payment[]>(`/api/payments?contractId=${selectedContractForHistory.id}`)
      .then((data) => {
        setContractPayments(data.sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()));
      })
      .catch((error) => {
        console.error('Failed to load contract payments:', error);
      });
  }, [selectedContractForHistory]);

  const generatePDF = (contract: Contract) => {
    const property = properties.find(p => p.id === contract.propertyId);
    const tenant = users.find(u => u.uid === contract.tenantUid);
    const landlord = users.find(u => u.uid === contract.landlordUid) || profile;
    
    const doc = new jsPDF();
    let yPos = 20;
    const margin = 20;
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - 2 * margin;

    // Helper to add text and update yPos
    const addText = (text: string, fontSize: number, isBold: boolean = false, align: 'left' | 'center' | 'right' | 'justify' = 'left') => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      
      const lineHeight = fontSize * 0.3528 * 1.15;
      const lines = doc.splitTextToSize(text, contentWidth);
      const textHeight = lines.length * lineHeight;
      
      // Check page break
      if (yPos + textHeight > doc.internal.pageSize.height - margin) {
        doc.addPage();
        yPos = margin + 10;
      }

      if (align === 'justify') {
        doc.text(text, margin, yPos, { maxWidth: contentWidth, align: 'justify' });
      } else {
        doc.text(lines, align === 'center' ? pageWidth / 2 : margin, yPos, { align });
      }

      yPos += textHeight + 2;
    };

    const addHeader = (text: string) => {
      yPos += 4;
      addText(text, 11, true);
      yPos += 1;
    };

    const addParagraph = (text: string) => {
      addText(text, 10, false, 'justify');
    };

    // Title
    const propertyType = property?.type === 'commercial' ? 'COMERCIAIS' : 'RESIDENCIAIS';
    addText(`INSTRUMENTO PARTICULAR DE CONTRATO DE LOCAÇÃO DE IMÓVEL PARA FINS ${propertyType}`, 12, true, 'center');
    yPos += 6;

    // PARTES
    addHeader('PARTES');
    
    autoTable(doc, {
      startY: yPos,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: [242, 242, 242], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 35 } },
      body: [
        [{ content: 'LOCADOR', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: [242, 242, 242] } }],
        ['Nome', landlord?.displayName || 'N/A'],
        ['Endereço', landlord?.address || 'N/A'],
        ['CPF', landlord?.cpf || 'N/A'],
        [{ content: 'LOCATÁRIO', colSpan: 2, styles: { halign: 'center', fontStyle: 'bold', fillColor: [242, 242, 242] } }],
        ['Nome', tenant?.displayName || 'N/A'],
        ['Endereço', tenant?.address || 'N/A'],
        ['CPF', tenant?.cpf || 'N/A'],
      ],
    });
    
    yPos = (doc as any).lastAutoTable.finalY + 6;

    // OBJETO
    addHeader('OBJETO');
    addParagraph(`O LOCADOR dá em locação ao LOCATÁRIO o imóvel para fins ${property?.type === 'commercial' ? 'comerciais' : 'residenciais'} na ${property?.address || 'N/A'}, encontrando-se o imóvel ora locado em ótimas condições físicas conforme vistoria no ato da assinatura do presente contrato.`);

    // PRAZO
    addHeader('PRAZO');
    const startDate = format(parseISO(contract.startDate), 'dd/MM/yyyy');
    const endDate = format(parseISO(contract.endDate), 'dd/MM/yyyy');
    addParagraph(`O prazo de locação é fixado em 1 ANO, iniciando-se no dia ${startDate} e terminando no dia ${endDate}. A renovação do Contrato não será imediata, caso não haja anuência do LOCADOR. Este informará ao LOCATÁRIO sua rescisão por escrito no prazo de 30 (trinta) dias anteriores ao término do Contrato.`);

    // VALOR DO CONTRATO
    addHeader('VALOR DO CONTRATO');
    addParagraph(`O valor do aluguel mensal será igual a ${formatCurrency(contract.monthlyRent)}. O aluguel será corrigido anualmente de acordo com o índice de reajuste do Governo. O aluguel vencerá no dia ${contract.dueDay || 10} de cada mês.`);
    addParagraph(`O atraso no pagamento de quaisquer parcelas provocará multa de 2% e juros de mora à razão de 12% ao ano. Os aluguéis serão pagos pelo LOCATÁRIO no endereço do LOCADOR. Além do aluguel mensal, o LOCATÁRIO pagará as despesas de energia e de água.`);

    // DANOS
    addHeader('DANOS');
    addParagraph(`Quaisquer danos causados ao imóvel e/ou às suas instalações durante a locação, desde que por culpa do LOCATÁRIO, deverão ser reparados de forma satisfatória. Na hipótese de inadimplência, o LOCATÁRIO deverá ressarcir ao LOCADOR a indenização correspondente, corrigida com todos os acréscimos legalmente previstos, ou substituir as peças danificadas por outras de igual qualidade e valor.`);

    // OBRAS E BENFEITORIAS
    addHeader('OBRAS E BENFEITORIAS');
    addParagraph(`Caberá ao LOCADOR o direito de realizar e reter quaisquer benfeitorias necessárias que vier a realizar no imóvel. Em se tratando de benfeitorias úteis, desde que autorizadas previamente pelo LOCADOR, estas serão incorporadas ao imóvel e aceitas desde já pelo LOCATÁRIO. Quanto às benfeitorias voluptuárias, o LOCATÁRIO poderá retirá-las, desde que não afetem a estrutura do imóvel.`);

    // OBRIGAÇÕES
    addHeader('OBRIGAÇÕES');
    addParagraph(`O LOCATÁRIO se obriga a permitir ao LOCADOR examinar ou vistoriar o imóvel sempre que julgar necessário.`);

    // DESTINAÇÃO
    addHeader('DESTINAÇÃO');
    addParagraph(`O imóvel locado destina-se ao uso exclusivo do LOCATÁRIO para fins ${property?.type === 'commercial' ? 'comerciais' : 'residenciais'}, sendo vedada qualquer mudança deste contrato. A sublocação será de inteira responsabilidade do LOCATÁRIO.`);

    // INDENIZAÇÃO
    addHeader('INDENIZAÇÃO');
    addParagraph(`Em caso de rescisão antecipada deste contrato, o LOCATÁRIO deverá pagar ao LOCADOR, a título de indenização, o valor equivalente a 2 (dois) meses do aluguel vigente na data da rescisão, atendida a proporcionalidade prevista no artigo 4º da Lei 8.245/91 c/c artigo 924 do Código Civil.`);

    // VANTAGENS SUPERVENIENTES
    addHeader('VANTAGENS SUPERVENIENTES');
    addParagraph(`A locação estará sempre sujeita às disposições do Código Civil Brasileiro e da Lei 8.245/91, ficando assegurado ao LOCATÁRIO todos os direitos e garantias conferidos pela legislação vigente durante a locação.`);

    // FORO E ELEIÇÃO
    addHeader('FORO E ELEIÇÃO');
    addParagraph(`As partes elegem o Foro da Comarca de João Pessoa, Paraíba, como único competente para toda e qualquer demanda que verse sobre a locação, renunciando a qualquer outro, por mais privilegiado que seja.`);
    addParagraph(`E por estarem assim justos e contratados, firmam o presente instrumento em 2 (duas) vias de igual teor e forma, para um só efeito, na presença de 2 (duas) testemunhas também signatárias, comprometendo-se por si, seus herdeiros e sucessores, a cumprir fielmente o presente contrato.`);

    // Signatures
    yPos += 15;
    
    // Check page break for signatures
    if (yPos + 40 > doc.internal.pageSize.height - margin) {
      doc.addPage();
      yPos = margin + 10;
    }

    const today = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`João Pessoa, ${today}`, pageWidth - margin, yPos, { align: 'right' });
    
    yPos += 25;

    // Locatário and Locador
    doc.line(margin, yPos, margin + 70, yPos);
    doc.line(pageWidth - margin - 70, yPos, pageWidth - margin, yPos);
    
    yPos += 5;
    doc.text(tenant?.displayName?.toUpperCase() || 'LOCATÁRIO', margin + 35, yPos, { align: 'center' });
    doc.text(landlord?.displayName?.toUpperCase() || 'LOCADOR', pageWidth - margin - 35, yPos, { align: 'center' });
    
    yPos += 4;
    doc.text('Locatário', margin + 35, yPos, { align: 'center' });
    doc.text('Locador', pageWidth - margin - 35, yPos, { align: 'center' });

    yPos += 25;

    // Testemunhas
    doc.line(margin, yPos, margin + 70, yPos);
    doc.line(pageWidth - margin - 70, yPos, pageWidth - margin, yPos);
    
    yPos += 5;
    doc.text('TESTEMUNHA 1', margin + 35, yPos, { align: 'center' });
    doc.text('TESTEMUNHA 2', pageWidth - margin - 35, yPos, { align: 'center' });

    const pdfBlobUrl = doc.output('bloburl');
    window.open(pdfBlobUrl, '_blank');
    toast.success('PDF gerado com sucesso!');
  };

  // Payment-schedule generation, contract-renewal bookkeeping and the notification
  // email now all happen server-side (see src/server/routes/contracts.ts) — the
  // client just calls the endpoint and refetches.

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    try {
      await apiFetch('/api/contracts', { method: 'POST', body: JSON.stringify(formData) });
      toast.success('Contrato e cobranças gerados com sucesso!');
      setIsModalOpen(false);
      await Promise.all([fetchContracts(), apiFetch<Property[]>('/api/properties').then(setProperties)]);
    } catch (error) {
      console.error('Failed to create contract:', error);
      toast.error('Erro ao criar contrato.');
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStatus]);

  const handleToggleLateFee = async (contract: Contract) => {
    try {
      await apiFetch(`/api/contracts/${contract.id}/late-fee`, {
        method: 'PATCH',
        body: JSON.stringify({ lateFeeEnabled: !contract.lateFeeEnabled }),
      });
      toast.success(contract.lateFeeEnabled ? 'Multa/juros automáticos desativados.' : 'Multa/juros automáticos ativados.');
      await fetchContracts();
    } catch (error) {
      console.error('Failed to toggle late fee:', error);
      toast.error('Erro ao atualizar configuração de multa/juros.');
    }
  };

  const openRenewModal = (contract: Contract) => {
    setContractToRenew(contract);
    setRenewNewRent(String(contract.monthlyRent));
  };

  const handleRenew = async () => {
    if (!contractToRenew) return;
    const monthlyRent = Number(renewNewRent);
    if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
      toast.error('Informe um valor de aluguel válido.');
      return;
    }
    try {
      await apiFetch(`/api/contracts/${contractToRenew.id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ monthlyRent }),
      });
      toast.success('Contrato renovado e novas cobranças geradas!');
      await fetchContracts();
    } catch (error: any) {
      console.error('Failed to renew contract:', error);
      toast.error(error?.message || 'Erro ao renovar contrato.');
    } finally {
      setContractToRenew(null);
    }
  };

  const handleCancel = async () => {
    if (!contractToCancel) return;
    try {
      await apiFetch(`/api/contracts/${contractToCancel.id}/cancel`, { method: 'POST' });
      toast.success('Contrato cancelado com sucesso!');
      await Promise.all([fetchContracts(), apiFetch<Property[]>('/api/properties').then(setProperties)]);
    } catch (error) {
      console.error('Failed to cancel contract:', error);
      toast.error('Erro ao cancelar contrato.');
    } finally {
      setContractToCancel(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, contractId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type (PDF or images)
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      toast.error('Por favor, envie apenas arquivos PDF, JPG ou PNG.');
      return;
    }

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('O arquivo deve ter no máximo 5MB.');
      return;
    }

    setUploadingContractId(contractId);
    try {
      const fileExt = file.name.split('.').pop();
      const storageRef = ref(storage, `contracts/${contractId}/signed_contract_${Date.now()}.${fileExt}`);

      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      await apiFetch(`/api/contracts/${contractId}/signed`, {
        method: 'PATCH',
        body: JSON.stringify({ signedContractUrl: downloadUrl }),
      });

      toast.success('Contrato assinado anexado com sucesso!');
      await fetchContracts();
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Erro ao fazer upload do arquivo.');
    } finally {
      setUploadingContractId(null);
      // Reset input
      e.target.value = '';
    }
  };

  const filteredContracts = contracts.filter((contract) => {
    const property = properties.find(p => p.id === contract.propertyId);
    const tenant = users.find(u => u.uid === contract.tenantUid);
    const matchesStatus = filterStatus === 'all' || contract.status === filterStatus;
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch =
      !searchLower ||
      property?.address?.toLowerCase().includes(searchLower) ||
      tenant?.displayName?.toLowerCase().includes(searchLower) ||
      contract.id.toLowerCase().includes(searchLower);
    return matchesStatus && matchesSearch;
  });

  const totalPages = Math.ceil(filteredContracts.length / itemsPerPage);
  const paginatedContracts = filteredContracts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) return <ContractsTableSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Contratos</h2>
          <p className="text-gray-500 dark:text-gray-400">Acompanhe e gerencie todos os contratos de locação.</p>
        </div>
        {(isAdmin || isLandlord) && (
          <button
            onClick={() => {
              setFormData(prev => ({ ...prev, landlordUid: isLandlord ? profile.uid : '' }));
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Novo Contrato
          </button>
        )}
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por imóvel, inquilino ou ID..."
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
            <option value="active">Ativo</option>
            <option value="pending">Pendente</option>
            <option value="expired">Expirado</option>
            <option value="renewed">Renovado</option>
            <option value="cancelled">Cancelado</option>
            <option value="terminated">Encerrado</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Imóvel</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Inquilino</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Vigência</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Valor</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {paginatedContracts.map((contract) => {
                const property = properties.find(p => p.id === contract.propertyId);
                const tenant = users.find(u => u.uid === contract.tenantUid);
                return (
                  <tr key={contract.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Building2 className="w-5 h-5 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[200px]">{property?.address || 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <User className="w-5 h-5 text-gray-400" />
                        <span className="text-sm text-gray-600 dark:text-gray-300">{tenant?.displayName || 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        {format(parseISO(contract.startDate), 'dd/MM/yy')} - {format(parseISO(contract.endDate), 'dd/MM/yy')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(contract.monthlyRent)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        contract.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                        contract.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
                      }`}>
                        {contract.status === 'active' ? 'Ativo' : 
                         contract.status === 'cancelled' ? 'Cancelado' :
                         contract.status === 'renewed' ? 'Renovado' : contract.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => generatePDF(contract)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                          title="Baixar PDF"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => setSelectedContractForHistory(contract)}
                          className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
                          title="Histórico de Pagamentos"
                        >
                          <History className="w-4 h-4" />
                        </button>
                        
                        {contract.signedContractUrl ? (
                          <a
                            href={contract.signedContractUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                            title="Ver Contrato Assinado"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </a>
                        ) : (isAdmin || isLandlord) && contract.status === 'active' ? (
                          <div className="relative">
                            <input
                              type="file"
                              id={`upload-${contract.id}`}
                              className="hidden"
                              accept=".pdf,image/jpeg,image/png"
                              onChange={(e) => handleFileUpload(e, contract.id)}
                              disabled={uploadingContractId === contract.id}
                            />
                            <label
                              htmlFor={`upload-${contract.id}`}
                              className={`p-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                                uploadingContractId === contract.id 
                                  ? 'text-gray-400 bg-gray-50 dark:bg-gray-700 cursor-not-allowed' 
                                  : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'
                              }`}
                              title="Anexar Contrato Assinado"
                            >
                              {uploadingContractId === contract.id ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <Upload className="w-4 h-4" />
                              )}
                            </label>
                          </div>
                        ) : null}

                        {(isAdmin || isLandlord) && contract.status === 'active' && (
                          <>
                            <button
                              onClick={() => {
                                apiFetch(`/api/contracts/${contract.id}/notify`, { method: 'POST' })
                                  .then(() => toast.success('E-mail de notificação enviado!'))
                                  .catch((error) => {
                                    console.error('Failed to resend contract email:', error);
                                    toast.error('Erro ao enviar e-mail.');
                                  });
                              }}
                              className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded-lg transition-colors"
                              title="Reenviar E-mail"
                            >
                              <Mail className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleToggleLateFee(contract)}
                              className={`p-2 rounded-lg transition-colors ${
                                contract.lateFeeEnabled
                                  ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400'
                                  : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30'
                              }`}
                              title={contract.lateFeeEnabled ? 'Multa/juros automáticos ativados (clique para desativar)' : 'Ativar multa/juros automáticos em atrasos'}
                            >
                              <Percent className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => isRenewable(contract) && openRenewModal(contract)}
                              disabled={!isRenewable(contract)}
                              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                              title={isRenewable(contract) ? 'Renovar Contrato' : `Renovação disponível a partir de ${renewalWindowDays} dias antes do vencimento`}
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setContractToCancel(contract)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                              title="Cancelar Contrato"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
          {paginatedContracts.map((contract) => {
            const property = properties.find(p => p.id === contract.propertyId);
            const tenant = users.find(u => u.uid === contract.tenantUid);
            return (
              <div key={contract.id} className="p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate max-w-[200px]">{property?.address || 'N/A'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{tenant?.displayName || 'N/A'}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    contract.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                    contract.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
                  }`}>
                    {contract.status === 'active' ? 'Ativo' : 
                     contract.status === 'cancelled' ? 'Cancelado' :
                     contract.status === 'renewed' ? 'Renovado' : contract.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 py-2 border-y border-gray-50 dark:border-gray-700/50">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Vigência</p>
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                      {format(parseISO(contract.startDate), 'dd/MM/yy')} - {format(parseISO(contract.endDate), 'dd/MM/yy')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Valor Mensal</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(contract.monthlyRent)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => generatePDF(contract)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                      title="Baixar PDF"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setSelectedContractForHistory(contract)}
                      className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
                      title="Histórico de Pagamentos"
                    >
                      <History className="w-5 h-5" />
                    </button>
                    {contract.signedContractUrl && (
                      <a
                        href={contract.signedContractUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                      </a>
                    )}
                  </div>

                  {(isAdmin || isLandlord) && contract.status === 'active' && (
                    <div className="flex items-center gap-1">
                      {!contract.signedContractUrl && (
                        <div className="relative">
                          <input
                            type="file"
                            id={`upload-mobile-${contract.id}`}
                            className="hidden"
                            accept=".pdf,image/jpeg,image/png"
                            onChange={(e) => handleFileUpload(e, contract.id)}
                            disabled={uploadingContractId === contract.id}
                          />
                          <label
                            htmlFor={`upload-mobile-${contract.id}`}
                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg cursor-pointer flex items-center justify-center"
                          >
                            {uploadingContractId === contract.id ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                          </label>
                        </div>
                      )}
                      <button
                        onClick={() => handleToggleLateFee(contract)}
                        className={`p-2 rounded-lg transition-colors ${
                          contract.lateFeeEnabled
                            ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30'
                        }`}
                        title={contract.lateFeeEnabled ? 'Multa/juros automáticos ativados' : 'Ativar multa/juros automáticos'}
                      >
                        <Percent className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => isRenewable(contract) && openRenewModal(contract)}
                        disabled={!isRenewable(contract)}
                        title={isRenewable(contract) ? 'Renovar Contrato' : `Renovação disponível a partir de ${renewalWindowDays} dias antes do vencimento`}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      >
                        <RefreshCw className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setContractToCancel(contract)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredContracts.length === 0 && (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 dark:text-gray-500">Nenhum contrato encontrado.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Mostrando <span className="font-bold text-gray-900 dark:text-white">{(currentPage - 1) * itemsPerPage + 1}</span> a <span className="font-bold text-gray-900 dark:text-white">{Math.min(currentPage * itemsPerPage, filteredContracts.length)}</span> de <span className="font-bold text-gray-900 dark:text-white">{filteredContracts.length}</span> contratos
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900/50">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Novo Contrato</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Imóvel</label>
                <select
                  required
                  value={formData.propertyId}
                  onChange={(e) => {
                    const p = properties.find(prop => prop.id === e.target.value);
                    setFormData({ ...formData, propertyId: e.target.value, monthlyRent: p?.monthlyRent || 0 });
                  }}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Selecione um imóvel</option>
                  {properties.filter(p => p.status === 'available').map(p => (
                    <option key={p.id} value={p.id}>{p.address}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Locador</label>
                <select
                  required
                  value={formData.landlordUid}
                  onChange={(e) => setFormData({ ...formData, landlordUid: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Selecione um locador</option>
                  {users.filter(u => u.role === 'landlord').map(l => (
                    <option key={l.uid} value={l.uid}>{l.displayName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Inquilino</label>
                <select
                  required
                  value={formData.tenantUid}
                  onChange={(e) => setFormData({ ...formData, tenantUid: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Selecione um inquilino</option>
                  {users.filter(u => u.role === 'tenant').map(t => (
                    <option key={t.uid} value={t.uid}>{t.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data Início</label>
                  <input
                    type="date"
                    required
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data Término</label>
                  <input
                    type="date"
                    required
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor Mensal (R$)</label>
                  <input
                    type="number"
                    required
                    value={formData.monthlyRent}
                    onChange={(e) => setFormData({ ...formData, monthlyRent: Number(e.target.value) })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dia de Vencimento</label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="31"
                    value={formData.dueDay}
                    onChange={(e) => setFormData({ ...formData, dueDay: Number(e.target.value) })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!formData.lateFeeEnabled}
                  onChange={(e) => setFormData({ ...formData, lateFeeEnabled: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  Aplicar multa e juros automaticamente em pagamentos atrasados
                  <span className="block text-xs text-gray-400 dark:text-gray-500">2% de multa + 1% ao mês de juros, proporcional aos dias de atraso (apenas exibido — não altera o valor da parcela).</span>
                </span>
              </label>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 dark:shadow-none"
                >
                  Criar Contrato
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!contractToRenew}
        title="Renovar Contrato"
        message="Deseja renovar este contrato por mais 12 meses? Novas cobranças serão geradas automaticamente."
        confirmText="Renovar"
        onConfirm={handleRenew}
        onCancel={() => setContractToRenew(null)}
        isDestructive={false}
      >
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Valor mensal do aluguel
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={renewNewRent}
            onChange={(e) => setRenewNewRent(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Ajuste o valor caso haja reajuste na renovação, ou mantenha o valor atual.
          </p>
        </div>
      </ConfirmModal>

      <ConfirmModal
        isOpen={!!contractToCancel}
        title="Cancelar Contrato"
        message="Tem certeza que deseja cancelar este contrato? O imóvel será marcado como disponível novamente."
        confirmText="Cancelar Contrato"
        onConfirm={handleCancel}
        onCancel={() => setContractToCancel(null)}
        isDestructive={true}
      />

      {/* Payment History Modal */}
      {selectedContractForHistory && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900/50">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Histórico de Pagamentos</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Contrato #{selectedContractForHistory.id.slice(0, 8)}</p>
              </div>
              <button onClick={() => setSelectedContractForHistory(null)} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-white dark:hover:bg-gray-700 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {contractPayments.length > 0 ? (
                <div className="space-y-3">
                  {contractPayments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          payment.status === 'paid' ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 
                          payment.status === 'overdue' ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                        }`}>
                          {payment.status === 'paid' ? <CheckCircle className="w-5 h-5" /> : 
                           payment.status === 'overdue' ? <AlertCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(payment.amount)}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Vencimento: {format(parseISO(payment.dueDate), 'dd/MM/yyyy')}</p>
                          {selectedContractForHistory.lateFeeEnabled && payment.status === 'pending' && (() => {
                            const fee = calculateLateFee(payment.amount, payment.dueDate);
                            return fee.daysLate > 0 ? (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                                + multa/juros: {formatCurrency(fee.fine + fee.interest)} (total {formatCurrency(fee.total)})
                              </p>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          payment.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                          payment.status === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                        }`}>
                          {payment.status === 'paid' ? 'Pago' : payment.status === 'overdue' ? 'Atrasado' : 'Pendente'}
                        </span>
                        {payment.paidAt && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Pago em: {format(parseISO(payment.paidAt), 'dd/MM/yy')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                  <p className="text-gray-400 dark:text-gray-500">Nenhum pagamento registrado para este contrato.</p>
                </div>
              )}
            </div>
            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setSelectedContractForHistory(null)}
                className="px-6 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium shadow-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
