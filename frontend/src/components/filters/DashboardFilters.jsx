export default function DashboardFilters() {
  return (
    <div className="flex gap-2">
      <select className="border rounded px-3 py-2 text-sm">
        <option>All Models</option>
      </select>
      <select className="border rounded px-3 py-2 text-sm">
        <option>All Modules</option>
      </select>
      <select className="border rounded px-3 py-2 text-sm">
        <option>All Sources</option>
      </select>
      <select className="border rounded px-3 py-2 text-sm">
        <option>All Severities</option>
      </select>
    </div>
  );
}
