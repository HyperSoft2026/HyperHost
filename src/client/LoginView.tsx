import React from 'react';
import { PublicPortal } from './PublicPortal';
import type { HealthReportDTO } from '../shared/types';

interface LoginViewProps {
  health: HealthReportDTO | null;
  onRefreshAuth: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onRefreshAuth }) => {
  return (
    <PublicPortal
      currentPath="/"
      onNavigate={(path) => {
        window.history.pushState({}, '', path);
        onRefreshAuth();
      }}
      user={null}
      onOpenDashboard={onRefreshAuth}
    />
  );
};
