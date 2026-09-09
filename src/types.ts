export type UserRole = 'admin' | 'landlord' | 'tenant';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  phone?: string;
  cpf?: string;
  address?: string;
  themePreference?: 'light' | 'dark' | 'system';
  createdAt: string;
}

export interface Property {
  id: string;
  address: string;
  type: 'residential' | 'commercial';
  description: string;
  ownerUid: string;
  monthlyRent: number;
  status: 'available' | 'rented' | 'maintenance';
}

export interface Contract {
  id: string;
  propertyId: string;
  landlordUid: string;
  tenantUid: string;
  startDate: string;
  endDate: string;
  dueDay: number;
  monthlyRent: number;
  status: 'active' | 'expired' | 'terminated' | 'pending';
  pdfUrl?: string;
  signedAt?: string;
  signedContractUrl?: string;
}

export interface Payment {
  id: string;
  contractId: string;
  tenantUid: string;
  amount: number;
  dueDate: string;
  paidAt?: string;
  status: 'pending' | 'paid' | 'overdue';
  receiptUrl?: string;
}

export interface AppSettings {
  id?: string;
  appName: string;
  companyName: string;
  supportEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string;
  smtpPasswordConfigured?: boolean;
  emailFrom: string;
  updatedAt?: string;
}
