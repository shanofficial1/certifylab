export function Label({ className = "", ...props }) {
  return <label className={`text-sm text-slate-100 ${className}`} {...props} />;
}
