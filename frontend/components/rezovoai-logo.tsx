interface RezovoaiLogoProps {
  size?: number;
  className?: string;
}

export function RezovoaiLogo({ size = 20, className = "" }: RezovoaiLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M 20 20 L 20 80 L 28 80 L 28 54 L 52 54 L 52 46 L 28 46 L 28 28 L 60 28 C 68 28 72 32 72 40 C 72 48 68 52 60 52 L 56 52 L 56 60 L 60 60 L 80 80 L 80 72 L 64 56 C 72 54 80 48 80 40 C 80 28 72 20 60 20 Z"
        fill="currentColor"
      />
    </svg>
  );
}
