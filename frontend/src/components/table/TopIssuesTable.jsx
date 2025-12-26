import Card from "../common/Card";

export default function TopIssuesTable({ data }) {
  return (
    <Card title="Top Issues">
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 dark:bg-slate-700">
            <tr>
              <th className="p-2 text-left text-slate-900 dark:text-slate-100">Source</th>
              <th className="p-2 text-left text-slate-900 dark:text-slate-100">Model</th>
              <th className="p-2 text-right text-slate-900 dark:text-slate-100">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
            {data.slice(0, 10).map((row, i) => (
              <tr key={i}>
                <td className="p-2 text-slate-900 dark:text-slate-100">{row.source}</td>
                <td className="p-2 text-slate-900 dark:text-slate-100">{row.model}</td>
                <td className="p-2 text-right text-slate-900 dark:text-slate-100">{row.issue_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
