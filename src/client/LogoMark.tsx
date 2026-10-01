import React from 'react';

interface LogoMarkProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export const LogoMark: React.FC<LogoMarkProps> = ({
  size = 'md',
  showText = true,
}) => {
  const dimensions =
    size === 'sm'
      ? 'w-8 h-8'
      : size === 'lg'
      ? 'w-14 h-14'
      : 'w-10 h-10';

  return (
    <div className="flex items-center gap-3 select-none">
      <div
        className={`${dimensions} rounded-xl bg-[#131524] border border-indigo-500/30 flex items-center justify-center overflow-hidden shrink-0`}
      >
        <img
          src="/assets/Logo.png"
          alt="HyperHost Official Logo"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain p-1"
        />
      </div>
      {showText && (
        <div className="leading-tight">
          <div className="text-base font-bold tracking-tight text-white">
            HyperHost
          </div>
          <div className="text-[11px] font-medium text-indigo-300/80">
            Powered by HyperSoft
          </div>
        </div>
      )}
    </div>
  );
};
