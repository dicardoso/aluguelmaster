// Mirrors Dashboard.tsx's real layout (title, 4 KPI cards, chart + recent contracts)
// so there's no layout jump once the data arrives. Design: example_loading/Loading AluguelMaster.dc.html.
const bar = 'rounded bg-gray-100 dark:bg-gray-700 animate-pulse';

export default function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className={`h-7 w-56 ${bar}`} />
        <div className={`h-4 w-72 ${bar}`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-4">
            <div className={`w-11 h-11 rounded-lg shrink-0 ${bar}`} />
            <div className="flex-1 space-y-2">
              <div className={`h-2.5 w-3/4 ${bar}`} />
              <div className={`h-4 w-1/3 ${bar}`} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm space-y-5">
          <div className={`h-4 w-36 ${bar}`} />
          <div className="h-40 flex items-end gap-5 px-2">
            {['58%', '90%', '40%', '70%'].map((h, i) => (
              <div key={i} className={`flex-1 ${bar}`} style={{ height: h }} />
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm space-y-5">
          <div className={`h-4 w-40 ${bar}`} />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg shrink-0 ${bar}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-3 w-1/2 ${bar}`} />
                <div className={`h-2.5 w-1/3 ${bar}`} />
              </div>
              <div className={`h-5 w-14 rounded-full shrink-0 ${bar}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
