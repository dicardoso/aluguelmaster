import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { logout } from '../firebase';
import { apiFetch } from '../lib/api';
import { Property, Contract } from '../types';
import { LayoutDashboard, Building2, FileText, CreditCard, LogOut, User, Users, Settings as SettingsIcon, Moon, Sun, Monitor, Menu, X, Search, Plus, Home, UserRound } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SearchResult {
  key: string;
  label: string;
  sublabel: string;
  path: string;
  icon: typeof Home;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, isLandlord, updateTheme } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Global search — lazily loads properties/contracts/(admin: users directory) on the
  // first search and filters client-side; results just navigate to the owning page,
  // since none of the list pages support deep-linking to one item yet.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchDataRef = useRef<{ properties: Property[]; contracts: Contract[]; users: any[] } | null>(null);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        if (!searchDataRef.current) {
          const [properties, contracts, users] = await Promise.all([
            apiFetch<Property[]>('/api/properties'),
            apiFetch<Contract[]>('/api/contracts'),
            apiFetch<any[]>('/api/users/directory'),
          ]);
          searchDataRef.current = { properties, contracts, users };
        }
        const { properties, contracts, users } = searchDataRef.current;
        const results: SearchResult[] = [];

        properties.forEach((p) => {
          if (`${p.address} ${p.description || ''}`.toLowerCase().includes(query)) {
            results.push({ key: `property-${p.id}`, label: p.address, sublabel: 'Imóvel', path: '/properties', icon: Home });
          }
        });

        contracts.forEach((c) => {
          const property = properties.find((p) => p.id === c.propertyId);
          const tenant = users.find((u) => u.id === c.tenantUid);
          const haystack = `${property?.address || ''} ${tenant?.displayName || ''} ${c.id}`.toLowerCase();
          if (haystack.includes(query)) {
            results.push({
              key: `contract-${c.id}`,
              label: property?.address || `Contrato #${c.id.slice(0, 8)}`,
              sublabel: tenant ? `Contrato · ${tenant.displayName}` : 'Contrato',
              path: '/contracts',
              icon: FileText,
            });
          }
        });

        if (isAdmin) {
          users.forEach((u) => {
            if (`${u.displayName} ${u.cpf || ''}`.toLowerCase().includes(query)) {
              results.push({ key: `user-${u.id}`, label: u.displayName, sublabel: 'Usuário', path: '/users', icon: UserRound });
            }
          });
        }

        setSearchResults(results.slice(0, 8));
        setSearchOpen(true);
      } catch (error) {
        console.error('Global search failed:', error);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery, isAdmin]);

  const goToSearchResult = (result: SearchResult) => {
    setSearchQuery('');
    setSearchOpen(false);
    navigate(result.path);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, show: true },
    { name: 'Imóveis', path: '/properties', icon: Building2, show: isAdmin || isLandlord },
    { name: 'Inquilinos', path: '/users', icon: Users, show: isAdmin },
    { name: 'Contratos', path: '/contracts', icon: FileText, show: true },
    { name: 'Financeiro', path: '/payments', icon: CreditCard, show: true },
    { name: 'Configurações', path: '/settings', icon: SettingsIcon, show: isAdmin },
  ];

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 font-sans transition-colors duration-200 overflow-hidden">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            AluguelMaster
          </h1>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="lg:hidden p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {menuItems.filter(item => item.show).map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setIsMobileMenuOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                location.pathname === item.path
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between px-3 py-2 mb-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <button
              onClick={() => updateTheme('light')}
              className={cn("p-1.5 rounded-md transition-colors", profile?.themePreference === 'light' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')}
              title="Tema Claro"
            >
              <Sun className="w-4 h-4" />
            </button>
            <button
              onClick={() => updateTheme('system')}
              className={cn("p-1.5 rounded-md transition-colors", (!profile?.themePreference || profile?.themePreference === 'system') ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')}
              title="Tema do Sistema"
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              onClick={() => updateTheme('dark')}
              className={cn("p-1.5 rounded-md transition-colors", profile?.themePreference === 'dark' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')}
              title="Tema Escuro"
            >
              <Moon className="w-4 h-4" />
            </button>
          </div>

          <Link
            to="/profile"
            onClick={() => setIsMobileMenuOpen(false)}
            className="flex items-center gap-3 px-3 py-2 mb-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold">
              {profile?.displayName?.charAt(0) || <User className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{profile?.displayName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate capitalize">{profile?.role}</p>
            </div>
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header / Global Search */}
        <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 lg:px-8 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="relative flex-1 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                placeholder="Busca global (imóveis, contratos, inquilinos...)"
                className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              {searchOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden z-40">
                  {searchResults.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">Nenhum resultado encontrado.</p>
                  ) : (
                    searchResults.map((result) => (
                      <button
                        key={result.key}
                        type="button"
                        onMouseDown={() => goToSearchResult(result)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <result.icon className="w-4 h-4 text-gray-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{result.label}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{result.sublabel}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/contracts', { state: { openNewModal: true } })}
              className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all hover:shadow-md active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Novo Contrato
            </button>
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 hidden sm:block" />
            <Link to="/profile" className="flex items-center gap-3 group">
              <div className="text-right hidden md:block">
                <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{profile?.displayName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{profile?.role}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold border-2 border-white dark:border-gray-800 shadow-sm">
                {profile?.displayName?.charAt(0) || <User className="w-4 h-4" />}
              </div>
            </Link>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-4 lg:p-8 bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
