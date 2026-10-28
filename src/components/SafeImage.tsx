import { useState } from 'react';
import { Utensils } from 'lucide-react';

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function SafeImage({ src, alt, className = '' }: SafeImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200/80 text-stone-500 p-6 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Utensils className="w-6 h-6 mb-2 text-stone-400" />
        <span className="text-xs font-medium text-stone-600 line-clamp-2">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
