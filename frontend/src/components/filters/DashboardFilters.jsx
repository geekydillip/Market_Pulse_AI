export default function DashboardFilters() {
  return (
    <div className="flex gap-2">
      <select className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded px-3 py-2 text-sm">
        <option>All Models</option>
      </select>
      <select className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded px-3 py-2 text-sm">
        <option>All Modules</option>
      </select>
      <select className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded px-3 py-2 text-sm">
        <option>All Sources</option>
      </select>
      <select className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded px-3 py-2 text-sm">
        <option>All Severities</option>
      </select>
    </div>
  );
}
