// Real header, shimmer rows — matches Contracts.tsx's desktop table columns so the
// page doesn't jump once data arrives. Design: example_loading/Loading AluguelMaster.dc.html.
const bar = 'rounded bg-gray-100 dark:bg-gray-700 animate-pulse';

const ROW_COUNT = 5;

export default function ContractsTableSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
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
            {Array.from({ length: ROW_COUNT }).map((_, i) => (
              <tr key={i} style={{ opacity: 1 - i * 0.14 }}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg shrink-0 ${bar}`} />
                    <div className={`h-3 w-32 ${bar}`} />
                  </div>
                </td>
                <td className="px-6 py-4"><div className={`h-3 w-24 ${bar}`} /></td>
                <td className="px-6 py-4"><div className={`h-3 w-28 ${bar}`} /></td>
                <td className="px-6 py-4"><div className={`h-3 w-16 ${bar}`} /></td>
                <td className="px-6 py-4"><div className={`h-5 w-16 rounded-full ${bar}`} /></td>
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-2">
                    <div className={`w-6 h-6 rounded ${bar}`} />
                    <div className={`w-6 h-6 rounded ${bar}`} />
                    <div className={`w-6 h-6 rounded ${bar}`} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {Array.from({ length: ROW_COUNT }).map((_, i) => (
          <div key={i} className="p-4 space-y-3" style={{ opacity: 1 - i * 0.14 }}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg shrink-0 ${bar}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-3 w-2/3 ${bar}`} />
                <div className={`h-2.5 w-1/2 ${bar}`} />
              </div>
              <div className={`h-5 w-14 rounded-full shrink-0 ${bar}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
