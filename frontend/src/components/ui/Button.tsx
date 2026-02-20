import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className,
  ...rest
}) => {
  const isDisabled = disabled || loading;
  const sizeClasses = size === 'sm' ? 'h-10 text-sm px-4' : 'h-11 text-sm px-5';

  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400 transition-shadow transition-transform duration-200 ease-out';

  const variantClasses: Record<Variant, string> = {
    primary:
      'text-white btn-gradient elevated rounded-full transform hover:-translate-y-1 active:translate-y-0',
    secondary:
      'text-zinc-900 bg-white border border-zinc-200 hover:bg-zinc-50 premium-shadow transform hover:-translate-y-1 active:translate-y-0',
    ghost: 'bg-transparent text-zinc-700 hover:bg-zinc-50',
  };

  const disabledClasses = isDisabled ? 'opacity-60 cursor-not-allowed transform-none shadow-none' : '';

  const classes = `${base} ${sizeClasses} ${variantClasses[variant]} ${disabledClasses} ${className ?? ''}`.trim();

  return (
    <button {...rest} disabled={isDisabled} className={classes}>
      {loading ? (
        <svg className="animate-spin mr-2 text-white" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" strokeWidth="3" strokeOpacity="0.25"></circle>
          <path d="M22 12a10 10 0 00-10-10" strokeWidth="3"></path>
        </svg>
      ) : null}
      <span className={loading ? 'opacity-90' : ''}>{children}</span>
    </button>
  );
};

export default Button;
