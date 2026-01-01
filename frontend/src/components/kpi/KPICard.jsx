import Card from "../common/Card";

export default function KPICard({ title, value, severity }) {
  const color =
    severity === "high" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100";

  return (
    <Card>
      <div className="text-sm text-slate-500 dark:text-slate-300">{title}</div>
      <div className={`text-3xl font-bold ${color}`}>
        {value?.toLocaleString()}
      </div>
    </Card>
  );
}
