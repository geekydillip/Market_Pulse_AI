import Card from "../common/Card";

export default function KPICard({ title, value, severity }) {
  const color =
    severity === "high" ? "text-red-600" : "text-slate-900";

  return (
    <Card>
      <div className="text-sm text-slate-500">{title}</div>
      <div className={`text-3xl font-bold ${color}`}>
        {value?.toLocaleString()}
      </div>
    </Card>
  );
}
