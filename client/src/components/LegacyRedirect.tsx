import { Navigate, useLocation } from 'react-router-dom';

export default function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const location = useLocation();
  return (
    <Navigate
      to={`${location.pathname.replace(from, to)}${location.search}${location.hash}`}
      replace
    />
  );
}
