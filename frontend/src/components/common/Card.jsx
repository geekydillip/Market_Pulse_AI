export default function Card({ title, children }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      {title && (
        <h3 className="text-sm font-semibold text-slate-600 mb-2">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
