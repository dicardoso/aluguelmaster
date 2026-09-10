import { Building2 } from 'lucide-react';

// Full-app splash — shown while Firebase auth resolves and the profile bootstraps
// (see ProtectedRoute in App.tsx). Design: example_loading/Loading AluguelMaster.dc.html.
export default function BrandLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 transition-colors">
      <div className="flex flex-col items-center gap-7">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-28 h-28 rounded-[28px] bg-blue-600 dark:bg-blue-500 opacity-30 animate-ping [animation-duration:2.6s]" />
          <div className="relative w-20 h-20 rounded-[22px] flex items-center justify-center bg-blue-50 dark:bg-blue-900/40 border border-blue-100 dark:border-blue-800/60">
            <Building2 className="w-10 h-10 text-blue-600 dark:text-blue-400" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-4 h-[3px] rounded-full bg-blue-600 dark:bg-blue-400"
                  style={{
                    animation: 'brand-window 2.2s ease-in-out infinite',
                    animationDelay: `${i * 0.16}s`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3.5">
          <p className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">AluguelMaster</p>
          <div className="w-40 h-[3px] rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
            <div
              className="w-1/3 h-full rounded-full bg-blue-600 dark:bg-blue-500"
              style={{ animation: 'brand-progress 1.5s cubic-bezier(.65,.05,.36,1) infinite' }}
            />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse [animation-duration:2.2s]">
            Carregando sua gestão imobiliária…
          </p>
        </div>
      </div>
    </div>
  );
}
