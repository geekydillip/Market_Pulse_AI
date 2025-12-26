export default function Card({ title, titleClassName, children }) {
  const defaultTitleClass = "text-sm font-semibold text-slate-600 dark:text-slate-200 mb-2";
  const titleClass = titleClassName || defaultTitleClass;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
      {title && (
        <h3 className={titleClass}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
