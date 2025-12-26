import Card from "../common/Card";

export default function TopIssuesTable({ data }) {
  return (
    <Card title="Top Issues">
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100">
            <tr>
              <th className="p-2 text-left">Source</th>
              <th className="p-2 text-left">Model</th>
              <th className="p-2 text-right">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.slice(0, 10).map((row, i) => (
              <tr key={i}>
                <td className="p-2">{row.source}</td>
                <td className="p-2">{row.model}</td>
                <td className="p-2 text-right">{row.issue_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
