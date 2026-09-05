import { cn } from '@/lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const variants: Record<Variant, string> = {
  default: 'bg-blue-900/50 text-blue-300 ring-blue-800/50',
  success: 'bg-emerald-900/50 text-emerald-300 ring-emerald-800/50',
  warning: 'bg-yellow-900/50 text-yellow-300 ring-yellow-800/50',
  danger: 'bg-red-900/50 text-red-300 ring-red-800/50',
  info: 'bg-purple-900/50 text-purple-300 ring-purple-800/50',
  muted: 'bg-slate-800 text-slate-400 ring-slate-700/50',
};

export function Badge({
  children,
  variant = 'default',
  className,
  ...props
}: React.ComponentProps<'span'> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
