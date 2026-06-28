import type { ReactNode } from 'react';

export function Loading(): ReactNode {
  return (
    <div className="loading">
      <div className="spinner" />
      Loading…
    </div>
  );
}

export function ErrorState({ message }: { message: string }): ReactNode {
  return <div className="error">{message}</div>;
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}
